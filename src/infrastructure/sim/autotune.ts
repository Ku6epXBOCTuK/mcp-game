import type {
	BalanceContent,
	GameContent,
} from "../../domain/content/types.ts";
import {
	simulate,
	type SimulationMetrics,
} from "../../domain/game/simulator.ts";

export type AutotuneOptions = {
	content: GameContent;
	durationSec?: number;
	seed?: number;
};

export type AutotuneResult = {
	balance: BalanceContent;
	metrics: SimulationMetrics;
	score: number;
	trials: number;
	changes: string[];
};

const RATE_CANDIDATES = [1, 2, 3, 4, 6, 8, 12, 16];
const COST_CANDIDATES = [0.5, 1, 2];
const PAYBACK_MIN_SEC = 3 * 60;
const PAYBACK_MAX_SEC = 15 * 60;
const PRESTIGE_TARGET_SEC = 4 * 60 * 60;
const PRESTIGE_MIN_SEC = 2 * 60 * 60;
const PRESTIGE_MAX_SEC = 6 * 60 * 60;
const IDLE_MAX_RATIO = 0.6;

export function scoreMetrics(metrics: SimulationMetrics): number {
	let score = 0;
	const median = metrics.medianPaybackSec;
	if (median === null) {
		score += 60;
	} else if (median < PAYBACK_MIN_SEC) {
		score += (PAYBACK_MIN_SEC - median) / 60;
	} else if (median > PAYBACK_MAX_SEC) {
		score += (median - PAYBACK_MAX_SEC) / 60;
	}
	const prestige = metrics.timeToPrestigeSec;
	if (prestige === null) {
		score += 60;
	} else if (prestige < PRESTIGE_MIN_SEC) {
		score += (PRESTIGE_MIN_SEC - prestige) / 60;
	} else if (prestige > PRESTIGE_MAX_SEC) {
		score += (prestige - PRESTIGE_MAX_SEC) / 60;
	}
	if (metrics.idleRatio > IDLE_MAX_RATIO) {
		score += (metrics.idleRatio - IDLE_MAX_RATIO) * 100;
	}
	score += metrics.bottlenecks.length * 0.5;
	return Math.round(score * 1000) / 1000;
}

export function scaledContent(
	content: GameContent,
	rateScale: number,
	costScale: number,
	prestigeGoldThreshold: number,
): GameContent {
	const rateBase: Record<string, number> = {};
	for (const [skill, value] of Object.entries(content.balance.rateBase)) {
		rateBase[skill] = Number((value * rateScale).toFixed(6));
	}
	const upgradeCostScale: Record<string, number> = {};
	for (const upgrade of content.upgrades) {
		upgradeCostScale[upgrade.id] = costScale;
	}
	return {
		...content,
		balance: {
			...content.balance,
			rateBase,
			upgradeCostScale,
			prestigeGoldThreshold,
		},
	};
}

type Candidate = {
	rateScale: number;
	costScale: number;
	threshold: number;
	metrics: SimulationMetrics;
	score: number;
};

function evaluate(
	base: GameContent,
	rateScale: number,
	costScale: number,
	seed: number,
	durationSec: number,
): Candidate {
	const probe = simulate({
		content: scaledContent(base, rateScale, costScale, Number.MAX_SAFE_INTEGER),
		seed,
		durationSec,
	});
	let threshold = Math.max(
		100,
		Math.round((probe.metrics.goldPerMinute * PRESTIGE_TARGET_SEC) / 60),
	);
	let metrics = probe.metrics;
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const result = simulate({
			content: scaledContent(base, rateScale, costScale, threshold),
			seed,
			durationSec,
		});
		metrics = result.metrics;
		const prestige = metrics.timeToPrestigeSec;
		if (prestige === null) {
			threshold = Math.max(100, Math.round(threshold / 2));
			continue;
		}
		if (prestige >= PRESTIGE_MIN_SEC && prestige <= PRESTIGE_MAX_SEC) break;
		threshold = Math.max(
			100,
			Math.round(threshold * (PRESTIGE_TARGET_SEC / prestige)),
		);
	}
	return {
		rateScale,
		costScale,
		threshold,
		metrics,
		score: scoreMetrics(metrics),
	};
}

export function autotune(options: AutotuneOptions): AutotuneResult {
	const durationSec = options.durationSec ?? 12 * 60 * 60;
	const seed = options.seed ?? 7;
	const base = options.content;
	let trials = 0;
	let best: Candidate | null = null;

	for (const rateScale of RATE_CANDIDATES) {
		for (const costScale of COST_CANDIDATES) {
			const candidate = evaluate(base, rateScale, costScale, seed, durationSec);
			trials += 6;
			if (!best || candidate.score < best.score) best = candidate;
		}
	}

	if (!best) throw new Error("autotune: no candidate evaluated");
	const winner = best;
	const balance = scaledContent(
		base,
		winner.rateScale,
		winner.costScale,
		winner.threshold,
	).balance;

	const changes: string[] = [];
	if (winner.rateScale !== 1) changes.push(`rateBase x${winner.rateScale}`);
	if (winner.costScale !== 1) {
		changes.push(`upgradeCostScale x${winner.costScale}`);
	}
	changes.push(`prestigeGoldThreshold ${winner.threshold}`);

	return {
		balance,
		metrics: winner.metrics,
		score: winner.score,
		trials,
		changes,
	};
}
