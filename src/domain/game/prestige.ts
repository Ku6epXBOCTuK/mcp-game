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

export const DEFAULT_PRESTIGE_GOLD_THRESHOLD = 1000;

export function prestigePoints(
	totalGoldEarned: number,
	threshold = DEFAULT_PRESTIGE_GOLD_THRESHOLD,
): number {
	if (totalGoldEarned <= 0) return 0;
	if (threshold <= 0) return 0;
	return Math.floor(Math.sqrt(totalGoldEarned / threshold));
}

export function previewPrestige(
	state: GameState,
	content: GameContent,
): PrestigePreview {
	const threshold =
		content.balance.prestigeGoldThreshold ?? DEFAULT_PRESTIGE_GOLD_THRESHOLD;
	const points = prestigePoints(state.stats.totalGoldEarned, threshold);
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
	const preview = previewPrestige(state, content);
	if (preview.points <= 0) {
		const threshold =
			content.balance.prestigeGoldThreshold ?? DEFAULT_PRESTIGE_GOLD_THRESHOLD;
		return err({
			code: "NotSupported",
			message: `Престиж пока недоступен: нужно заработать хотя бы ${threshold} золота суммарно.`,
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
		bank: { deposits: 0, credit: state.bank.credit, accruedAt: now },
		counters: { gathered: {}, crafted: {}, killed: {} },
		stats: { totalGoldEarned: 0 },
		prestige: {
			points: totalPoints,
			layers: preview.layers,
			runs: preview.runs + 1,
			multipliers,
		},
		updatedAt: now,
	});
}
