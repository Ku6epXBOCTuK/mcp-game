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

type DomainError = import("../shared/errors.ts").DomainError;

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
	const gold = price * amount;
	const inventory = { ...state.inventory };
	const left = available - amount;
	if (left <= 0) delete inventory[itemId];
	else inventory[itemId] = left;
	return ok({
		...applyGoldIncome(state, content, gold),
		inventory,
		stats: {
			...state.stats,
			totalGoldEarned: state.stats.totalGoldEarned + gold,
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
		wallet: { ...state.wallet, gold: state.wallet.gold - cost },
		updatedAt: now,
	});
}
