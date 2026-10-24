import {
	type Result,
	ok,
	err,
	itemUnknown,
	insufficientFunds,
} from "../shared/result.ts";
import type { GameContent } from "../content/types.ts";
import type { GameState, ItemId } from "./types.ts";
import { marketBuyPrice, marketSellPrice } from "./market.ts";
import { applyGoldIncome } from "./bank.ts";
import { eventMultipliers, upgradeMultiplier } from "./multipliers.ts";
import { gainXp } from "./skills.ts";

import type { DomainError } from "../shared/errors.ts";

const DEFAULT_TRADING_XP_PER_GOLD = 0.1;

// NOTE: only selling pays the trading xp: a buy costs gold and the market
// spread makes a round trip a loss, so paying for xp would be a gold sink.
function tradingXp(
	state: GameState,
	content: GameContent,
	gold: number,
): number {
	const rate = content.balance.tradingXpPerGold ?? DEFAULT_TRADING_XP_PER_GOLD;
	if (rate <= 0 || gold <= 0) return 0;
	const multipliers = eventMultipliers(state, content);
	return (
		gold *
		rate *
		multipliers.xp *
		upgradeMultiplier(state, content, "xpMultiplier", "trading")
	);
}

export function sellItem(
	state: GameState,
	content: GameContent,
	itemId: ItemId,
	qty: number,
	now: number,
): Result<GameState, DomainError> {
	const item = content.items.find((entry) => entry.id === itemId);
	if (!item) return itemUnknown(itemId);
	const amount = Math.floor(qty);
	if (!Number.isFinite(amount) || amount <= 0) {
		return err({
			code: "UnknownCommand",
			message: `Некорректное количество: ${qty}.`,
			command: `sell:${itemId}`,
		});
	}
	const available = state.inventory[itemId] ?? 0;
	if (available < amount) {
		return err({
			code: "NotEnoughResources",
			message: `Не хватает предмета "${itemId}": нужно ${amount}, есть ${available}.`,
			item: itemId,
			required: amount,
			available,
		});
	}
	const price = Math.floor(marketSellPrice(state, content, itemId));
	const em = eventMultipliers(state, content);
	const gold = Math.floor(price * amount * em.gold);
	const inventory = { ...state.inventory };
	const left = available - amount;
	if (left <= 0) delete inventory[itemId];
	else inventory[itemId] = left;
	const next = gainXp(
		applyGoldIncome(state, content, gold),
		"trading",
		tradingXp(state, content, gold),
		content.balance.xpBase,
		content.balance.xpExponent,
	);
	return ok({
		...next,
		inventory,
		stats: {
			...next.stats,
			totalGoldEarned: next.stats.totalGoldEarned + gold,
		},
		updatedAt: now,
	});
}

export function buyItem(
	state: GameState,
	content: GameContent,
	itemId: ItemId,
	qty: number,
	now: number,
): Result<GameState, DomainError> {
	const item = content.items.find((entry) => entry.id === itemId);
	if (!item) return itemUnknown(itemId);
	const amount = Math.floor(qty);
	if (!Number.isFinite(amount) || amount <= 0) {
		return err({
			code: "UnknownCommand",
			message: `Некорректное количество: ${qty}.`,
			command: `buy:${itemId}`,
		});
	}
	if (item.buyPrice <= 0) {
		return err({
			code: "NotSupported",
			message: `Предмет "${itemId}" нельзя купить на рынке.`,
			feature: `buy:${itemId}`,
		});
	}
	const price = Math.ceil(marketBuyPrice(state, content, itemId));
	const cost = price * amount;
	if (state.wallet.gold < cost) {
		return insufficientFunds(cost, state.wallet.gold);
	}
	return ok({
		...state,
		inventory: {
			...state.inventory,
			[itemId]: (state.inventory[itemId] ?? 0) + amount,
		},
		counters: {
			...state.counters,
			bought: {
				...state.counters.bought,
				[itemId]: (state.counters.bought[itemId] ?? 0) + amount,
			},
		},
		wallet: { ...state.wallet, gold: state.wallet.gold - cost },
		updatedAt: now,
	});
}
