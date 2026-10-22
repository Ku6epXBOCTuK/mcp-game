import { test } from "vitest";
import assert from "node:assert/strict";
import {
	maxHpFor,
	regenerateHealth,
	useItem,
} from "../../src/domain/game/health.ts";
import { tick } from "../../src/domain/game/tick.ts";
import { createInitialState } from "../../src/domain/game/state.ts";
import type { GameContent } from "../../src/domain/content/types.ts";
import type { ActiveAction, GameState } from "../../src/domain/game/types.ts";

const CONTENT: GameContent = {
	skills: [],
	items: [
		{
			id: "potion_health",
			name: "Зелье здоровья",
			type: "material",
			sellPrice: 35,
			buyPrice: 70,
		},
		{
			id: "wood",
			name: "Дерево",
			type: "resource",
			sellPrice: 2,
			buyPrice: 4,
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
	],
	zones: [
		{ id: "meadow", name: "Луг", unlock: { kind: "none" }, monsters: ["wolf"] },
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
		playerMaxHpPerCombatLevel: 10,
		playerHealthRegenPerSec: 1,
		potionHealthHealPercent: 0.5,
		playerDamageBase: 1,
		playerDamagePerLevel: 0.5,
	},
};

function state(overrides: Partial<GameState> = {}): GameState {
	const base = createInitialState("p1", 42, 1000);
	return { ...base, ...overrides };
}

function withCombatLevel(level: number): GameState {
	const before = state();
	return {
		...before,
		skills: { ...before.skills, combat: { id: "combat", level, xp: 0 } },
	};
}

test("max hp grows with the combat level", () => {
	assert.equal(maxHpFor(state(), CONTENT), 100);
	assert.equal(maxHpFor(withCombatLevel(11), CONTENT), 200);
});

test("health regenerates over time", () => {
	const before = state({ health: { hp: 40, maxHp: 100 } });
	const after = regenerateHealth(before, CONTENT, 30);
	assert.equal(after.health.hp, 70);
	assert.equal(after.health.maxHp, 100);
});

test("regeneration never exceeds the maximum hp", () => {
	const before = state({ health: { hp: 90, maxHp: 100 } });
	const after = regenerateHealth(before, CONTENT, 60);
	assert.equal(after.health.hp, 100);
});

test("a tick restores health while the player is idle", () => {
	const before = state({ health: { hp: 30, maxHp: 100 } });
	const after = tick(before, { content: CONTENT, now: 1000 + 60 });
	assert.equal(after.health.hp, 90);
});

test("drinking a potion heals half of the maximum hp and consumes it", () => {
	const before = state({
		health: { hp: 30, maxHp: 100 },
		inventory: { potion_health: 2 },
	});
	const result = useItem(before, CONTENT, "potion_health", 1000);
	assert.equal(result.isErr(), false);
	if (result.isErr()) return;
	assert.equal(result.value.health.hp, 80);
	assert.equal(result.value.inventory.potion_health, 1);
});

test("a potion does not interrupt the current action", () => {
	const action: ActiveAction = {
		kind: "fight",
		skill: "combat",
		targetId: "wolf",
		startedAt: 1000,
		endsAt: 1000,
		monsterHpLeft: 10,
		monsterHitInSec: 5,
	};
	const before = state({
		activeAction: action,
		health: { hp: 10, maxHp: 100 },
		inventory: { potion_health: 1 },
	});
	const result = useItem(before, CONTENT, "potion_health", 1000);
	assert.equal(result.isErr(), false);
	if (result.isErr()) return;
	assert.equal(result.value.activeAction?.targetId, "wolf");
});

test("using a potion without stock fails", () => {
	const result = useItem(
		state({ health: { hp: 10, maxHp: 100 } }),
		CONTENT,
		"potion_health",
		1000,
	);
	assert.equal(result.isErr(), true);
	assert.equal(result.isErr() && result.error.code, "NotEnoughResources");
});

test("using a potion at full health fails", () => {
	const result = useItem(
		state({ health: { hp: 100, maxHp: 100 }, inventory: { potion_health: 1 } }),
		CONTENT,
		"potion_health",
		1000,
	);
	assert.equal(result.isErr(), true);
	assert.equal(result.isErr() && result.error.code, "NotSupported");
});

test("using an item that cannot be used fails", () => {
	const result = useItem(
		state({ inventory: { wood: 5 } }),
		CONTENT,
		"wood",
		1000,
	);
	assert.equal(result.isErr(), true);
	assert.equal(result.isErr() && result.error.code, "NotSupported");
});
