import type { GameContent } from "../content/types.ts";
import type { GameState } from "./types.ts";
import {
	type Result,
	ok,
	err,
	itemUnknown,
	notEnoughResources,
} from "../shared/result.ts";

import type { DomainError } from "../shared/errors.ts";

export const DEFAULT_HEALTH_REGEN_PER_SEC = 1;
export const DEFAULT_POTION_HEAL_PERCENT = 0.5;

export function maxHpFor(state: GameState, content: GameContent): number {
	const perLevel = content.balance.playerMaxHpPerCombatLevel ?? 0;
	const level = state.skills.combat?.level ?? 1;
	return content.balance.playerMaxHp + perLevel * Math.max(0, level - 1);
}

export function regenerateHealth(
	state: GameState,
	content: GameContent,
	elapsed: number,
): GameState {
	const maxHp = maxHpFor(state, content);
	const rate =
		content.balance.playerHealthRegenPerSec ?? DEFAULT_HEALTH_REGEN_PER_SEC;
	if (rate <= 0 || elapsed <= 0) {
		return {
			...state,
			health: { hp: Math.min(state.health.hp, maxHp), maxHp },
		};
	}
	const hp = Math.min(maxHp, state.health.hp + rate * elapsed);
	return { ...state, health: { hp, maxHp } };
}

export function useItem(
	state: GameState,
	content: GameContent,
	itemId: string,
	now: number,
): Result<GameState, DomainError> {
	const item = content.items.find((entry) => entry.id === itemId);
	if (!item) return itemUnknown(itemId);
	if (item.id !== "potion_health") {
		return err({
			code: "NotSupported",
			message: `Предмет "${item.id}" нельзя использовать.`,
			feature: `use:${item.id}`,
		});
	}
	const available = state.inventory[itemId] ?? 0;
	if (available <= 0) {
		return notEnoughResources(itemId, 1, available);
	}
	const maxHp = maxHpFor(state, content);
	if (state.health.hp >= maxHp) {
		return err({
			code: "NotSupported",
			message: "Здоровье уже полное.",
			feature: `use:${itemId}`,
		});
	}
	const percent =
		content.balance.potionHealthHealPercent ?? DEFAULT_POTION_HEAL_PERCENT;
	const heal = Math.max(1, Math.round(maxHp * percent));
	const inventory = { ...state.inventory };
	const left = available - 1;
	if (left <= 0) delete inventory[itemId];
	else inventory[itemId] = left;
	return ok({
		...state,
		inventory,
		health: { hp: Math.min(maxHp, state.health.hp + heal), maxHp },
		updatedAt: now,
	});
}
