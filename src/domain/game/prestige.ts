import { type Result, ok, err } from "../shared/result.ts";
import type { GameContent } from "../content/types.ts";
import type { GameState } from "./types.ts";
import { createSkills } from "./state.ts";

export type PrestigePreview = {
	points: number;
	layers: number;
	runs: number;
	goldMultiplier: number;
	productionMultiplier: number;
};

export function prestigePoints(totalGoldEarned: number): number {
	if (totalGoldEarned <= 0) return 0;
	return Math.floor(Math.sqrt(totalGoldEarned / 1000));
}

export function previewPrestige(state: GameState): PrestigePreview {
	const points = prestigePoints(state.stats.totalGoldEarned);
	const layers = state.prestige.layers + 1;
	return {
		points,
		layers,
		runs: state.prestige.runs,
		goldMultiplier: 1 + points * 0.1,
		productionMultiplier: 1 + points * 0.05,
	};
}

export function prestige(
	state: GameState,
	content: GameContent,
	now: number,
): Result<GameState, import("../shared/errors.ts").DomainError> {
	const preview = previewPrestige(state);
	if (preview.points <= 0) {
		return err({
			code: "NotSupported",
			message:
				"Престиж пока недоступен: нужно заработать хотя бы 1000 золота суммарно.",
			feature: "prestige",
		});
	}

	const totalPoints = state.prestige.points + preview.points;
	const multipliers = {
		...state.prestige.multipliers,
		gold: 1 + totalPoints * 0.1,
		production: 1 + totalPoints * 0.05,
	};

	return ok({
		...state,
		wallet: { gold: 0, credits: 0 },
		inventory: {},
		skills: createSkills(),
		activeAction: null,
		activeEvents: [],
		health: {
			hp: content.balance.playerMaxHp,
			maxHp: content.balance.playerMaxHp,
		},
		upgrades: {},
		quests: {},
		market: state.market,
		bank: { deposits: 0, credit: 0, accruedAt: now },
		counters: { gathered: {}, crafted: {}, killed: {} },
		prestige: {
			points: totalPoints,
			layers: preview.layers,
			runs: preview.runs + 1,
			multipliers,
		},
		updatedAt: now,
	});
}
