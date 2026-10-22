import { nextRandom } from "../shared/rng.ts";
import { tradingDiscount } from "../shared/curves.ts";
import type { GameContent } from "../content/types.ts";
import type { GameState, ItemId } from "./types.ts";

const MAX_DRIFT_STEPS = 20;

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
	const factor = driftFactor(state, itemId, item.sellPrice);
	const discount = tradingDiscount(state.skills.trading?.level ?? 1);
	return item.buyPrice * factor * (1 - discount);
}

export function refreshMarket(
	state: GameState,
	content: GameContent,
	now: number,
): GameState {
	const interval = content.balance.marketDriftIntervalSec;
	const elapsed = now - state.market.updatedAt;
	if (elapsed < interval) return state;

	const steps = Math.min(MAX_DRIFT_STEPS, Math.floor(elapsed / interval));
	const range = content.balance.marketDriftRange;
	let rngState = { seed: state.market.seed, counter: state.market.counter };
	const random = (): number => {
		const result = nextRandom(rngState);
		rngState = result.state;
		return result.value;
	};

	const prices: Record<ItemId, number> = { ...state.market.prices };
	for (const item of content.items) {
		if (item.sellPrice <= 0) continue;
		const current = prices[item.id] ?? item.sellPrice;
		const drift = (random() * 2 - 1) * range;
		prices[item.id] = Math.max(1, Math.round(current * (1 + drift)));
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
