import { nextRandom } from "../shared/rng.ts";
import { tradingDiscount } from "../shared/curves.ts";
import type { GameContent, ItemContent } from "../content/types.ts";
import type { GameState, ItemId } from "./types.ts";

const MAX_DRIFT_STEPS = 1000;
const DEFAULT_REVERSION = 0.5;

function driftFactor(state: GameState, itemId: ItemId, base: number): number {
	const price = state.market.prices[itemId];
	if (!price || base <= 0) return 1;
	return price / base;
}

export function marketSellPrice(
	state: GameState,
	content: GameContent,
	itemId: ItemId,
): number {
	const item = content.items.find((entry) => entry.id === itemId);
	if (!item) return 0;
	const factor = driftFactor(state, itemId, item.sellPrice);
	const discount = tradingDiscount(state.skills.trading?.level ?? 1);
	return item.sellPrice * factor * (1 + discount);
}

export function marketBuyPrice(
	state: GameState,
	content: GameContent,
	itemId: ItemId,
): number {
	const item = content.items.find((entry) => entry.id === itemId);
	if (!item) return 0;
	return item.buyPrice * driftFactor(state, itemId, item.sellPrice);
}

// NOTE: the band is narrowed so that selling at the top of it can never pay
// off the buy at the bottom: the trader skill would otherwise shrink the
// spread below the price swing and turn the market into a money printer.
export function safeDriftRange(
	content: GameContent,
	item: ItemContent,
	discount: number,
): number {
	if (item.sellPrice <= 0 || item.buyPrice <= 0) return 0;
	const spread = item.buyPrice / item.sellPrice;
	if (spread <= 1) return 0;
	const limit = ((spread - (1 + discount)) / (spread + (1 + discount))) * 0.98;
	return Math.max(0, Math.min(content.balance.marketDriftRange, limit));
}

export function refreshMarket(
	state: GameState,
	content: GameContent,
	now: number,
): GameState {
	const interval = content.balance.marketDriftIntervalSec;
	const elapsed = now - state.market.updatedAt;
	if (elapsed < interval) return state;

	const steps = Math.floor(elapsed / interval);
	const applied = Math.min(steps, MAX_DRIFT_STEPS);
	const reversion = content.balance.marketReversion ?? DEFAULT_REVERSION;
	const discount = tradingDiscount(state.skills.trading?.level ?? 1);
	let rngState = { seed: state.market.seed, counter: state.market.counter };
	const random = (): number => {
		const result = nextRandom(rngState);
		rngState = result.state;
		return result.value;
	};

	const prices: Record<ItemId, number> = { ...state.market.prices };
	for (let step = 0; step < applied; step++) {
		for (const item of content.items) {
			if (item.sellPrice <= 0) continue;
			const base = item.sellPrice;
			const range = safeDriftRange(content, item, discount);
			if (range <= 0) {
				prices[item.id] = base;
				continue;
			}
			const current = prices[item.id] ?? base;
			const drift = (random() * 2 - 1) * range;
			let price = current * (1 + drift);
			price += (base - price) * reversion;
			const clamped = Math.min(
				base * (1 + range),
				Math.max(base * (1 - range), price),
			);
			prices[item.id] = Math.max(1, Math.round(clamped * 10000) / 10000);
		}
	}

	return {
		...state,
		market: {
			seed: state.market.seed,
			counter: rngState.counter,
			prices,
			updatedAt: state.market.updatedAt + steps * interval,
		},
	};
}
