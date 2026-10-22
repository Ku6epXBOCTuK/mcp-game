import type { GameContent } from "../content/types.ts";
import type { CombatBuff, GameState } from "./types.ts";

export const BUFF_ITEM_IDS = ["potion_strength", "elixir"] as const;

export const DEFAULT_POTION_STRENGTH_MULTIPLIER = 1.5;
export const DEFAULT_ELIXIR_MULTIPLIER = 2;

export function buffEffect(
	content: GameContent,
	itemId: string,
): { damageMultiplier: number } | null {
	const balance = content.balance;
	if (itemId === "potion_strength") {
		return {
			damageMultiplier:
				balance.potionStrengthDamageMultiplier ??
				DEFAULT_POTION_STRENGTH_MULTIPLIER,
		};
	}
	if (itemId === "elixir") {
		return {
			damageMultiplier:
				balance.elixirDamageMultiplier ?? DEFAULT_ELIXIR_MULTIPLIER,
		};
	}
	return null;
}

export function isBuffItem(itemId: string): boolean {
	return buffItemIds().includes(itemId);
}

function buffItemIds(): string[] {
	return [...BUFF_ITEM_IDS];
}

export function buffDamageMultiplier(buffs: CombatBuff[]): number {
	return buffs.reduce((acc, buff) => acc * buff.damageMultiplier, 1);
}

export function pendingBuffMultiplier(state: GameState): number {
	return buffDamageMultiplier(state.combatBuffs ?? []);
}

export function applyBuffItem(
	state: GameState,
	content: GameContent,
	itemId: string,
): GameState {
	const effect = buffEffect(content, itemId);
	if (!effect) return state;
	const inventory = { ...state.inventory };
	const left = (inventory[itemId] ?? 0) - 1;
	if (left <= 0) delete inventory[itemId];
	else inventory[itemId] = left;
	const action = state.activeAction;
	if (action && action.kind === "fight") {
		return {
			...state,
			inventory,
			activeAction: {
				...action,
				damageMultiplier:
					(action.damageMultiplier ?? 1) * effect.damageMultiplier,
			},
		};
	}
	return {
		...state,
		inventory,
		combatBuffs: [
			...(state.combatBuffs ?? []),
			{ id: itemId, damageMultiplier: effect.damageMultiplier },
		],
	};
}
