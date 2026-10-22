import { test } from "vitest";
import assert from "node:assert/strict";
import { tick } from "../../src/domain/game/tick.ts";
import {
	createInitialState,
	migrateState,
	STATE_VERSION,
} from "../../src/domain/game/state.ts";
import { DEFAULT_COMBAT_POLICY } from "../../src/domain/game/combat.ts";
import type { GameContent } from "../../src/domain/content/types.ts";
import type {
	CombatPolicy,
	FightAction,
	GameState,
} from "../../src/domain/game/types.ts";

const CONTENT: GameContent = {
	skills: [],
	items: [
		{
			id: "pelt",
			name: "Шкура",
			type: "resource",
			sellPrice: 25,
			buyPrice: 50,
		},
		{
			id: "potion_health",
			name: "Зелье здоровья",
			type: "food",
			sellPrice: 30,
			buyPrice: 60,
		},
	],
	recipes: [],
	upgrades: [],
	monsters: [
		{
			id: "squire",
			name: "Оруженосец",
			zone: "forest",
			hp: 80,
			damage: 10,
			attackInterval: 4,
			xp: 15,
			dropTable: [{ item: "pelt", chance: 1, qty: 1 }],
		},
		{
			id: "wolf",
			name: "Волк",
			zone: "forest",
			hp: 100,
			damage: 10,
			attackInterval: 3,
			xp: 20,
			dropTable: [{ item: "pelt", chance: 1, qty: 1 }],
		},
		{
			id: "basilisk",
			name: "Басилиск",
			zone: "forest",
			hp: 120,
			damage: 10,
			attackInterval: 10,
			xp: 30,
			dropTable: [{ item: "pelt", chance: 1, qty: 1 }],
		},
		{
			id: "warden",
			name: "Страж",
			zone: "forest",
			hp: 400,
			damage: 10,
			attackInterval: 4,
			xp: 40,
			dropTable: [{ item: "pelt", chance: 1, qty: 1 }],
		},
	],
	zones: [],
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
		offlineCapSec: 120,
		rateBase: { combat: 1 },
		costGrowth: {},
		prestigeProductionExponent: 0.15,
		prestigeGoldExponent: 0.2,
		eventChancePerMinute: 0,
		playerMaxHp: 100,
		playerMaxHpPerCombatLevel: 0,
		playerHealthRegenPerSec: 0,
		potionHealthHealPercent: 0.5,
		playerDamageBase: 10,
		playerDamagePerLevel: 0,
	},
};

const REGEN_CONTENT: GameContent = {
	...CONTENT,
	balance: { ...CONTENT.balance, playerHealthRegenPerSec: 5 },
};

function state(overrides: Partial<GameState> = {}): GameState {
	return { ...createInitialState("p1", 42, 1000), ...overrides };
}

function monsterOf(id: string) {
	const monster = CONTENT.monsters.find((entry) => entry.id === id);
	assert.ok(monster);
	return monster;
}

function fightAction(monsterId: string): FightAction {
	const monster = monsterOf(monsterId);
	return {
		kind: "fight",
		skill: "combat",
		targetId: monster.id,
		startedAt: 1000,
		endsAt: 1000,
		monsterHpLeft: monster.hp,
		monsterHitInSec: monster.attackInterval,
	};
}

function runFight(
	action: FightAction,
	windowSec: number,
	stepSec: number,
	overrides: Partial<GameState> = {},
	content: GameContent = CONTENT,
): GameState {
	let current = state({ activeAction: action, ...overrides });
	let clock = 1000;
	while (clock < 1000 + windowSec) {
		clock = Math.min(1000 + windowSec, clock + stepSec);
		current = tick(current, { content, now: clock });
	}
	return current;
}

function policy(patch: Partial<CombatPolicy>): CombatPolicy {
	return { ...DEFAULT_COMBAT_POLICY, ...patch };
}

test("the fight outcome does not depend on the poll interval", () => {
	const steps = [1, 3, 7, 10, 30, 120];
	const results = steps.map((step) => runFight(fightAction("wolf"), 120, step));
	for (const result of results) {
		assert.equal(result.counters.killed.wolf, 1);
		assert.equal(result.inventory.pelt, 1);
		assert.equal(result.health.hp, 70);
		assert.equal(result.stats.deaths, 0);
		assert.equal(result.skills.combat?.level, 2);
		assert.equal(result.skills.combat?.xp, 5);
	}
});

test("a long offline tick matches many small ticks", () => {
	const one = runFight(fightAction("warden"), 30, 30);
	const many = runFight(fightAction("warden"), 30, 1);
	const seven = runFight(fightAction("warden"), 30, 7);
	assert.equal(one.health.hp, many.health.hp);
	assert.equal(one.health.hp, seven.health.hp);
	assert.equal(one.stats.deaths, many.stats.deaths);
	assert.equal(
		one.counters.killed.warden ?? 0,
		many.counters.killed.warden ?? 0,
	);
	assert.equal(one.activeAction?.kind, "fight");
	if (one.activeAction?.kind !== "fight") return;
	if (many.activeAction?.kind !== "fight") return;
	assert.equal(one.activeAction.monsterHpLeft, many.activeAction.monsterHpLeft);
	assert.ok(
		Math.abs(
			one.activeAction.monsterHitInSec - many.activeAction.monsterHitInSec,
		) < 1e-6,
	);
});

test("frequent polling no longer makes the player invulnerable", () => {
	const fast = runFight(fightAction("basilisk"), 12, 2);
	const slow = runFight(fightAction("basilisk"), 12, 12);
	assert.equal(fast.health.hp, slow.health.hp);
	assert.equal(fast.health.hp, 90);
	assert.ok(fast.health.hp < fast.health.maxHp);
});

test("health does not regenerate inside a fight", () => {
	const after = runFight(fightAction("warden"), 30, 30, {}, REGEN_CONTENT);
	assert.equal(after.health.hp, 30);
	assert.equal(after.activeAction?.kind, "fight");
});

test("idle time regenerates health", () => {
	const after = runFight(fightAction("wolf"), 30, 30, {}, REGEN_CONTENT);
	assert.equal(after.health.hp, 100);
});

test("a kill inside the tick counts as a kill, not as a death", () => {
	const before = state({
		activeAction: fightAction("squire"),
		health: { hp: 25, maxHp: 100 },
	});
	const after = tick(before, { content: CONTENT, now: 1030 });
	assert.equal(after.counters.killed.squire, 1);
	assert.equal(after.stats.deaths, 0);
	assert.equal(after.inventory.pelt, 1);
	assert.equal(after.health.hp, 15);
	assert.equal(after.activeAction, null);
});

test("death on the fatal hit gives no loot and no xp", () => {
	const before = state({
		activeAction: fightAction("warden"),
		health: { hp: 25, maxHp: 100 },
	});
	const after = tick(before, { content: CONTENT, now: 1030 });
	assert.equal(after.counters.killed.warden, undefined);
	assert.equal(after.inventory.pelt, undefined);
	assert.equal(after.skills.combat?.xp, 0);
	assert.equal(after.stats.deaths, 1);
	assert.equal(after.health.hp, 100);
	assert.equal(after.activeAction, null);
});

test("the auto potion policy keeps the player alive", () => {
	const without = runFight(fightAction("warden"), 30, 30, {
		health: { hp: 25, maxHp: 100 },
	});
	assert.equal(without.stats.deaths, 1);

	const withPolicy = runFight(fightAction("warden"), 30, 30, {
		health: { hp: 25, maxHp: 100 },
		inventory: { potion_health: 2 },
		combatPolicy: policy({ potionAtHpPercent: 50 }),
	});
	assert.equal(withPolicy.stats.deaths, 0);
	assert.ok(withPolicy.health.hp > 0);
	assert.equal(withPolicy.inventory.potion_health ?? 0, 0);
});

test("the flee policy ends the fight without a death", () => {
	const after = runFight(fightAction("warden"), 30, 30, {
		combatPolicy: policy({ fleeAtHpPercent: 60 }),
	});
	assert.equal(after.activeAction, null);
	assert.equal(after.stats.deaths, 0);
	assert.equal(after.inventory.pelt, undefined);
	assert.equal(after.health.hp, 60);
});

test("the auto repeat policy chains kills inside one tick", () => {
	const after = runFight(fightAction("wolf"), 30, 30, {
		combatPolicy: policy({ autoRepeat: true }),
	});
	assert.equal(after.counters.killed.wolf, 3);
	assert.equal(after.activeAction?.kind, "fight");
});

test("a kill that does not fit into the window does not end the fight", () => {
	const after = runFight(fightAction("squire"), 6, 6);
	assert.equal(after.counters.killed.squire, undefined);
	assert.equal(after.activeAction?.kind, "fight");
	if (after.activeAction?.kind !== "fight") return;
	assert.equal(after.activeAction.monsterHpLeft, 20);
	assert.equal(after.health.hp, 90);
});

test("a legacy fight action is migrated to the timeline model", () => {
	const legacy = {
		...createInitialState("p1", 42, 1000),
		version: 3,
		stats: { totalGoldEarned: 0 },
		activeAction: {
			kind: "fight",
			skill: "combat",
			targetId: "wolf",
			startedAt: 1000,
			endsAt: 1000,
			progress: 40,
		},
	} as unknown as GameState;
	const migrated = migrateState(legacy, CONTENT);
	assert.equal(migrated.version, STATE_VERSION);
	assert.equal(migrated.stats.deaths, 0);
	assert.deepEqual(migrated.combatPolicy, DEFAULT_COMBAT_POLICY);
	assert.equal(migrated.activeAction?.kind, "fight");
	if (migrated.activeAction?.kind !== "fight") return;
	assert.equal(migrated.activeAction.monsterHpLeft, 60);
	assert.equal(migrated.activeAction.monsterHitInSec, 3);
});
