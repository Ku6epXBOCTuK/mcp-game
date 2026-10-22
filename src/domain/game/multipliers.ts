import type { GameContent } from "../content/types.ts";
import type { GameState, SkillId } from "./types.ts";

export type Multipliers = {
	production: number;
	gold: number;
	xp: number;
	skillBonus: Partial<Record<SkillId, number>>;
};

export function upgradeMultiplier(
	state: GameState,
	content: GameContent,
	kind: "productionMultiplier" | "xpMultiplier",
	skill: SkillId,
): number {
	let multiplier = 1;
	for (const upgrade of content.upgrades) {
		if (upgrade.effect.kind !== kind) continue;
		const level = state.upgrades[upgrade.id] ?? 0;
		if (level <= 0) continue;
		const target = upgrade.effect.skill;
		if (target && target !== skill) continue;
		multiplier += upgrade.effect.valuePerLevel * level;
	}
	return multiplier;
}

export function eventMultipliers(
	state: GameState,
	content: GameContent,
): Multipliers {
	const multipliers: Multipliers = {
		production: 1,
		gold: 1,
		xp: 1,
		skillBonus: {},
	};
	const byId = new Map(content.events.map((event) => [event.id, event]));
	for (const active of state.activeEvents) {
		const event = byId.get(active.id);
		if (!event) continue;
		for (const modifier of event.modifiers) {
			switch (modifier.kind) {
				case "productionMultiplier":
					multipliers.production *= modifier.value;
					break;
				case "goldMultiplier":
					multipliers.gold *= modifier.value;
					break;
				case "xpMultiplier":
					multipliers.xp *= modifier.value;
					break;
				case "skillLevel": {
					const target = modifier.target as SkillId | undefined;
					if (target) {
						multipliers.skillBonus[target] =
							(multipliers.skillBonus[target] ?? 0) + modifier.value;
					}
					break;
				}
			}
		}
	}
	return multipliers;
}
