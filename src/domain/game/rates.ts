import { prestigeMultiplier, productionRate } from "../shared/curves.ts";
import type { GameContent } from "../content/types.ts";
import {
	eventMultipliers,
	upgradeMultiplier,
	type Multipliers,
} from "./multipliers.ts";
import type { GameState, SkillId } from "./types.ts";

export function gatherSkills(content: GameContent): SkillId[] {
	const skills = new Set<SkillId>();
	for (const item of content.items) {
		if (item.skill) skills.add(item.skill);
	}
	return [...skills];
}

export function maxCraftsByInputs(
	state: GameState,
	inputs: { item: string; qty: number }[],
): number {
	if (inputs.length === 0) return Number.POSITIVE_INFINITY;
	let limit = Number.POSITIVE_INFINITY;
	for (const input of inputs) {
		const available = state.inventory[input.item] ?? 0;
		limit = Math.min(limit, Math.floor(available / input.qty));
	}
	return Number.isFinite(limit) ? limit : 0;
}

function levelWithBonus(
	state: GameState,
	skill: SkillId,
	multipliers: Multipliers,
): number {
	return (
		(state.skills[skill]?.level ?? 1) + (multipliers.skillBonus[skill] ?? 0)
	);
}

function stateProductionRate(
	state: GameState,
	content: GameContent,
	skill: SkillId,
	rateBase: number,
	multipliers: Multipliers,
): number {
	return productionRate({
		rateBase,
		skillLevel: levelWithBonus(state, skill, multipliers),
		upgradeMult:
			upgradeMultiplier(state, content, "productionMultiplier", skill) *
			multipliers.production,
		prestigeMult: prestigeMultiplier(
			state.prestige.points,
			content.balance.prestigeProductionExponent,
		),
		k: content.balance.skillRateK,
	});
}

export function gatherRatePerMinute(
	state: GameState,
	content: GameContent,
	skill: SkillId,
	multipliers: Multipliers = eventMultipliers(state, content),
): number {
	return stateProductionRate(
		state,
		content,
		skill,
		content.balance.rateBase[skill] ?? 0,
		multipliers,
	);
}

export function craftSpeed(
	state: GameState,
	content: GameContent,
	skill: SkillId,
	multipliers: Multipliers = eventMultipliers(state, content),
): number {
	return stateProductionRate(state, content, skill, 1, multipliers);
}

export function passiveGoldPerSec(
	state: GameState,
	content: GameContent,
): number {
	let income = 0;
	for (const upgrade of content.upgrades) {
		if (upgrade.effect.kind !== "passiveIncome") continue;
		const level = state.upgrades[upgrade.id] ?? 0;
		if (level <= 0) continue;
		income += upgrade.effect.valuePerLevel * level;
	}
	return income;
}

export function passiveGoldPerMinute(
	state: GameState,
	content: GameContent,
	multipliers: Multipliers = eventMultipliers(state, content),
): number {
	const base = passiveGoldPerSec(state, content);
	if (base <= 0) return 0;
	const prestigeGold = prestigeMultiplier(
		state.prestige.points,
		content.balance.prestigeGoldExponent,
	);
	return base * 60 * multipliers.gold * prestigeGold;
}

export type ActiveActionEta = {
	kind: "gather" | "craft";
	seconds: number;
	unitsLeft: number | null;
};

export function activeActionEta(
	state: GameState,
	content: GameContent,
	multipliers: Multipliers = eventMultipliers(state, content),
): ActiveActionEta | null {
	const action = state.activeAction;
	if (!action) return null;
	if (action.kind === "gather") {
		const rate = gatherRatePerMinute(state, content, action.skill, multipliers);
		if (rate <= 0) return null;
		return {
			kind: "gather",
			seconds:
				((Math.floor(action.progress) + 1 - action.progress) / rate) * 60,
			unitsLeft: null,
		};
	}
	if (action.kind === "craft") {
		const recipe = content.recipes.find(
			(entry) => entry.id === action.targetId,
		);
		if (!recipe) return null;
		const affordable = maxCraftsByInputs(state, recipe.inputs);
		const cap = Math.min(
			affordable,
			action.remaining ?? Number.POSITIVE_INFINITY,
		);
		const unitsLeft = Number.isFinite(cap) ? cap : null;
		if (cap <= 0)
			return { kind: "craft", seconds: 0, unitsLeft: unitsLeft ?? 0 };
		const speed = craftSpeed(state, content, recipe.skill, multipliers);
		if (!Number.isFinite(cap)) {
			return {
				kind: "craft",
				seconds:
					((Math.floor(action.progress / recipe.timeSec) + 1) * recipe.timeSec -
						action.progress) /
					speed,
				unitsLeft: null,
			};
		}
		const workLeft =
			(Math.floor(action.progress / recipe.timeSec) + cap) * recipe.timeSec -
			action.progress;
		return { kind: "craft", seconds: workLeft / speed, unitsLeft };
	}
	return null;
}
