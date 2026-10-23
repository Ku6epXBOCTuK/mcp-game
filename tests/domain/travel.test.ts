import assert from "node:assert/strict";
import { test } from "vitest";
import type { GameContent } from "../../src/domain/content/types.ts";
import { startAction } from "../../src/domain/game/actions.ts";
import { createInitialState } from "../../src/domain/game/state.ts";
import { travelToZone } from "../../src/domain/game/travel.ts";
import type { GameState } from "../../src/domain/game/types.ts";

const CONTENT: GameContent = {
	skills: [],
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
	recipes: [],
	upgrades: [],
	monsters: [
		{
			id: "wolf",
			name: "Волк",
			zone: "meadow",
			hp: 10,
			damage: 1,
			attackInterval: 5,
			xp: 5,
			dropTable: [{ item: "pelt", chance: 1, qty: 1 }],
		},
		{
			id: "swamp_ooze",
			name: "Слизь",
			zone: "swamp",
			hp: 10,
			damage: 1,
			attackInterval: 5,
			xp: 5,
			dropTable: [{ item: "mushroom", chance: 1, qty: 1 }],
		},
	],
	zones: [
		{ id: "meadow", name: "Луг", unlock: { kind: "none" }, monsters: ["wolf"] },
		{
			id: "swamp",
			name: "Болото",
			unlock: { kind: "none" },
			monsters: ["swamp_ooze"],
		},
	],
	quests: [],
	events: [],
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
		rateBase: {},
		costGrowth: {},
		prestigeProductionExponent: 0.15,
		prestigeGoldExponent: 0.2,
		eventChancePerMinute: 0,
		playerMaxHp: 100,
		playerDamageBase: 1,
		playerDamagePerLevel: 0.5,
		travelTimeSec: 30,
	},
};

function state(overrides: Partial<GameState> = {}): GameState {
	const base = createInitialState("p1", 42, 1000);
	return { ...base, ...overrides };
}

test("travelToZone sets travelUntil when fast_travel is locked", () => {
	const s = state();
	const next = travelToZone(s, CONTENT, "swamp", 1000);
	assert.equal(next.travelUntil, 1000 + 30 * 1000);
	assert.equal(next.activeZone, "swamp");
});

test("travelToZone is instant when fast_travel is unlocked", () => {
	const s = state({ unlockedFeatures: ["fast_travel"] });
	const next = travelToZone(s, CONTENT, "swamp", 1000);
	assert.equal(next.travelUntil, 1000);
	assert.equal(next.activeZone, "swamp");
});

test("travelToZone ignores unknown zone", () => {
	const s = state();
	const next = travelToZone(s, CONTENT, "nowhere", 1000);
	assert.equal(next, s);
});

test("startAction is blocked while traveling", () => {
	const s = state({ travelUntil: 2000 });
	const result = startAction(
		s,
		CONTENT,
		{ kind: "gather", skill: "chopping", targetId: "wood" },
		1000,
	);
	assert.equal(result.isErr(), true);
	if (result.isErr()) assert.equal(result.error.code, "Traveling");
});

test("startAction is allowed after travelUntil passes", () => {
	const s = state({ travelUntil: 500 });
	const result = startAction(
		s,
		CONTENT,
		{ kind: "gather", skill: "chopping", targetId: "wood" },
		1000,
	);
	assert.equal(result.isErr(), false);
});

test("switchZone via startAction locks gated zones", () => {
	const result = startAction(
		state(),
		CONTENT,
		{ kind: "switch", zoneId: "swamp" },
		1000,
	);
	assert.equal(result.isErr(), false);
	if (result.isOk()) {
		assert.equal(result.value.activeZone, "swamp");
		assert.equal(result.value.travelUntil, 1000 + 30 * 1000);
	}
});
