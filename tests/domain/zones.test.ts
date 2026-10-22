import { test } from "vitest";
import assert from "node:assert/strict";
import { startAction } from "../../src/domain/game/actions.ts";
import { claimQuest } from "../../src/domain/game/quest-rewards.ts";
import { createInitialState } from "../../src/domain/game/state.ts";
import type { GameContent } from "../../src/domain/content/types.ts";
import type { GameState } from "../../src/domain/game/types.ts";

const CONTENT: GameContent = {
	skills: [],
	items: [],
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
			unlock: { kind: "quest", quest: "quest_swamp" },
			monsters: ["swamp_ooze"],
		},
	],
	quests: [
		{
			id: "quest_swamp",
			name: "Болото",
			steps: [{ kind: "kill", target: "wolf", qty: 1 }],
			rewards: [{ kind: "gold", id: "gold", qty: 100 }],
		},
	],
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
	},
};

function state(overrides: Partial<GameState> = {}): GameState {
	const base = createInitialState("p1", 42, 1000);
	return { ...base, ...overrides };
}

test("a quest-gated zone stays locked while the quest steps are open", () => {
	const result = startAction(
		state(),
		CONTENT,
		{ kind: "fight", monsterId: "swamp_ooze" },
		1000,
	);
	assert.equal(result.isErr(), true);
	assert.equal(result.isErr() && result.error.code, "ZoneLocked");
});

test("a quest-gated zone opens as soon as the quest steps are done", () => {
	const before = state({
		counters: {
			gathered: {},
			crafted: {},
			craftedItems: {},
			killed: { wolf: 1 },
		},
	});
	const result = startAction(
		before,
		CONTENT,
		{ kind: "fight", monsterId: "swamp_ooze" },
		1000,
	);
	assert.equal(result.isErr(), false);
});

test("a claimed quest keeps its zone open", () => {
	const claimed = claimQuest(
		state({
			counters: {
				gathered: {},
				crafted: {},
				craftedItems: {},
				killed: { wolf: 1 },
			},
		}),
		CONTENT,
		"quest_swamp",
		1000,
	);
	assert.equal(claimed.isOk(), true);
	if (claimed.isErr()) return;
	const result = startAction(
		claimed.value,
		CONTENT,
		{ kind: "fight", monsterId: "swamp_ooze" },
		1000,
	);
	assert.equal(result.isErr(), false);
});
