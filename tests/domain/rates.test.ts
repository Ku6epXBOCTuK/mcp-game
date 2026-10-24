import { test } from "vitest";
import assert from "node:assert/strict";
import {
	activeActionEta,
	craftSpeed,
	gatherRatePerMinute,
	gatherSkills,
	maxCraftsByInputs,
	passiveGoldPerMinute,
	passiveGoldPerSec,
} from "../../src/domain/game/rates.ts";
import { createInitialState } from "../../src/domain/game/state.ts";
import type { GameContent } from "../../src/domain/content/types.ts";
import type { GameState } from "../../src/domain/game/types.ts";

const CONTENT: GameContent = {
	skills: [
		{
			id: "chopping",
			name: "Рубка",
			description: "",
			xpCurve: { base: 15, exponent: 1.4 },
			unlockLevel: 1,
			icon: "axe",
		},
	],
	items: [
		{
			id: "wood",
			name: "Дерево",
			type: "resource",
			skill: "chopping",
			skillLevel: 1,
			sellPrice: 1,
			buyPrice: 2,
		},
	],
	recipes: [
		{
			id: "make_plank",
			output: { item: "plank", qty: 1 },
			inputs: [],
			skill: "crafting",
			skillLevel: 1,
			timeSec: 10,
		},
		{
			id: "make_beam",
			output: { item: "beam", qty: 1 },
			inputs: [{ item: "wood", qty: 2 }],
			skill: "crafting",
			skillLevel: 1,
			timeSec: 10,
		},
	],
	upgrades: [
		{
			id: "axe",
			name: "Топор",
			maxLevel: 10,
			costBase: 100,
			costGrowth: 1.15,
			effect: {
				kind: "productionMultiplier",
				skill: "chopping",
				valuePerLevel: 0.1,
			},
		},
		{
			id: "saw",
			name: "Пила",
			maxLevel: 10,
			costBase: 100,
			costGrowth: 1.15,
			effect: { kind: "productionMultiplier", valuePerLevel: 0.2 },
		},
		{
			id: "bank",
			name: "Банк",
			maxLevel: 10,
			costBase: 100,
			costGrowth: 1.35,
			effect: { kind: "passiveIncome", valuePerLevel: 0.5 },
		},
	],
	monsters: [],
	zones: [],
	quests: [],
	events: [
		{
			id: "fair",
			name: "Ярмарка",
			durationSec: 600,
			modifiers: [{ kind: "productionMultiplier", value: 2 }],
			weight: 1,
		},
		{
			id: "tax_day",
			name: "День сборов",
			durationSec: 600,
			modifiers: [{ kind: "goldMultiplier", value: 2 }],
			weight: 1,
		},
	],
	balance: {
		skillRateK: 0.1,
		xpBase: 15,
		xpExponent: 1.4,
		tradingDiscountPerLevel: 0.02,
		tradingDiscountMax: 0.4,
		marketDriftRange: 0.3,
		marketDriftIntervalSec: 300,
		maxTickSec: 3600,
		maxTickPerDaySec: 86400,
		offlineCapSec: 43200,
		rateBase: { chopping: 1 },
		costGrowth: { axe: 1.15, saw: 1.15, bank: 1.35 },
		prestigeProductionExponent: 0.15,
		prestigeGoldExponent: 0.2,
		eventChancePerMinute: 0,
		playerMaxHp: 100,
		playerDamageBase: 1,
		playerDamagePerLevel: 0.5,
	},
};

function state(overrides: Partial<GameState> = {}): GameState {
	return { ...createInitialState("p1", 42, 1000), ...overrides };
}

function closeTo(actual: number, expected: number, epsilon = 1e-9): void {
	assert.ok(
		Math.abs(actual - expected) < epsilon,
		`expected ${actual} to be close to ${expected}`,
	);
}

test("gatherSkills lists skills that have gatherable items", () => {
	assert.deepEqual(gatherSkills(CONTENT), ["chopping"]);
});

test("gatherRatePerMinute matches the productionRate composition", () => {
	closeTo(gatherRatePerMinute(state(), CONTENT, "chopping"), 1.1);
	closeTo(
		gatherRatePerMinute(state({ upgrades: { axe: 5 } }), CONTENT, "chopping"),
		1.65,
	);
	closeTo(
		gatherRatePerMinute(state({ upgrades: { saw: 1 } }), CONTENT, "chopping"),
		1.32,
	);
	closeTo(
		gatherRatePerMinute(
			state({ prestige: { ...state().prestige, points: 10 } }),
			CONTENT,
			"chopping",
		),
		1.1 * Math.pow(11, 0.15),
	);
});

test("active events raise the gather rate", () => {
	const withEvent = state({
		activeEvents: [{ id: "fair", startedAt: 0, endsAt: 1000 }],
	});
	closeTo(gatherRatePerMinute(withEvent, CONTENT, "chopping"), 2.2);
});

test("passiveGoldPerMinute applies gold multiplier and prestige", () => {
	closeTo(passiveGoldPerSec(state(), CONTENT), 0);
	closeTo(passiveGoldPerSec(state({ upgrades: { bank: 2 } }), CONTENT), 1);
	closeTo(passiveGoldPerMinute(state({ upgrades: { bank: 2 } }), CONTENT), 60);
	closeTo(
		passiveGoldPerMinute(
			state({
				upgrades: { bank: 2 },
				prestige: { ...state().prestige, points: 10 },
			}),
			CONTENT,
		),
		60 * Math.pow(11, 0.2),
	);
	closeTo(
		passiveGoldPerMinute(
			state({
				upgrades: { bank: 2 },
				activeEvents: [{ id: "tax_day", startedAt: 0, endsAt: 1000 }],
			}),
			CONTENT,
		),
		120,
	);
});

test("craftSpeed is the per-second work rate of a craft skill", () => {
	closeTo(craftSpeed(state(), CONTENT, "crafting"), 1.1);
	closeTo(
		craftSpeed(state({ upgrades: { saw: 1 } }), CONTENT, "crafting"),
		1.32,
	);
});

test("maxCraftsByInputs bounds by the scarcest input", () => {
	assert.equal(maxCraftsByInputs(state(), []), Number.POSITIVE_INFINITY);
	assert.equal(
		maxCraftsByInputs(state({ inventory: { wood: 5, stone: 4 } }), [
			{ item: "wood", qty: 2 },
			{ item: "stone", qty: 3 },
		]),
		1,
	);
	assert.equal(maxCraftsByInputs(state(), [{ item: "wood", qty: 2 }]), 0);
});

test("activeActionEta is null without an action", () => {
	assert.equal(activeActionEta(state(), CONTENT), null);
});

test("gather eta is the time to the next unit", () => {
	const fresh = state({
		activeAction: {
			kind: "gather",
			skill: "chopping",
			targetId: "wood",
			startedAt: 0,
			endsAt: 0,
			progress: 0,
		},
	});
	const eta = activeActionEta(fresh, CONTENT);
	closeTo(eta?.seconds ?? 0, 60 / 1.1);
	assert.equal(eta?.unitsLeft, null);

	const mid = state({
		activeAction: {
			kind: "gather",
			skill: "chopping",
			targetId: "wood",
			startedAt: 0,
			endsAt: 0,
			progress: 3.5,
		},
	});
	closeTo(activeActionEta(mid, CONTENT)?.seconds ?? 0, (0.5 / 1.1) * 60);
});

test("finite craft eta covers the whole batch including inputs cap", () => {
	const batch = state({
		activeAction: {
			kind: "craft",
			skill: "crafting",
			targetId: "make_plank",
			startedAt: 0,
			endsAt: 0,
			progress: 25,
			remaining: 5,
		},
	});
	const eta = activeActionEta(batch, CONTENT);
	closeTo(eta?.seconds ?? 0, 45 / 1.1);
	assert.equal(eta?.unitsLeft, 5);

	const capped = state({
		inventory: { wood: 5 },
		activeAction: {
			kind: "craft",
			skill: "crafting",
			targetId: "make_beam",
			startedAt: 0,
			endsAt: 0,
			progress: 25,
			remaining: 5,
		},
	});
	const cappedEta = activeActionEta(capped, CONTENT);
	closeTo(cappedEta?.seconds ?? 0, 15 / 1.1);
	assert.equal(cappedEta?.unitsLeft, 2);
});

test("endless craft eta is the time to the next unit", () => {
	const endless = state({
		activeAction: {
			kind: "craft",
			skill: "crafting",
			targetId: "make_plank",
			startedAt: 0,
			endsAt: 0,
			progress: 25,
		},
	});
	const eta = activeActionEta(endless, CONTENT);
	closeTo(eta?.seconds ?? 0, 5 / 1.1);
	assert.equal(eta?.unitsLeft, null);
});

test("stalled craft eta is zero with no units left", () => {
	const stalled = state({
		activeAction: {
			kind: "craft",
			skill: "crafting",
			targetId: "make_beam",
			startedAt: 0,
			endsAt: 0,
			progress: 25,
			remaining: 5,
		},
	});
	assert.deepEqual(activeActionEta(stalled, CONTENT), {
		kind: "craft",
		seconds: 0,
		unitsLeft: 0,
	});
});

test("fight eta is left to the combat forecast", () => {
	const fighting = state({
		activeAction: {
			kind: "fight",
			skill: "combat",
			targetId: "wolf",
			startedAt: 0,
			endsAt: 0,
			monsterHpLeft: 10,
			monsterHitInSec: 5,
		},
	});
	assert.equal(activeActionEta(fighting, CONTENT), null);
});
