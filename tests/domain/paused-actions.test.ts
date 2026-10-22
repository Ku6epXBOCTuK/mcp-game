import { test } from "vitest";
import assert from "node:assert/strict";
import {
	cancelAction,
	discardPausedActions,
	startAction,
} from "../../src/domain/game/actions.ts";
import { tick } from "../../src/domain/game/tick.ts";
import {
	createInitialState,
	migrateState,
} from "../../src/domain/game/state.ts";
import type { GameContent } from "../../src/domain/content/types.ts";
import type { GameState } from "../../src/domain/game/types.ts";

const CONTENT: GameContent = {
	skills: [],
	items: [
		{
			id: "wood",
			name: "Дерево",
			type: "resource",
			sellPrice: 2,
			buyPrice: 4,
			skill: "chopping",
			skillLevel: 1,
		},
		{
			id: "plank",
			name: "Доска",
			type: "material",
			sellPrice: 8,
			buyPrice: 16,
		},
		{
			id: "stone",
			name: "Камень",
			type: "resource",
			sellPrice: 2,
			buyPrice: 4,
			skill: "mining",
			skillLevel: 1,
		},
		{
			id: "herb",
			name: "Трава",
			type: "resource",
			sellPrice: 4,
			buyPrice: 8,
			skill: "magic",
			skillLevel: 1,
		},
	],
	recipes: [
		{
			id: "make_plank",
			output: { item: "plank", qty: 1 },
			inputs: [{ item: "wood", qty: 2 }],
			skill: "crafting",
			skillLevel: 1,
			timeSec: 10,
		},
	],
	upgrades: [],
	monsters: [
		{
			id: "wolf",
			name: "Волк",
			zone: "meadow",
			hp: 100,
			damage: 10,
			attackInterval: 5,
			xp: 5,
			dropTable: [],
		},
	],
	zones: [
		{
			id: "meadow",
			name: "Луг",
			unlock: { kind: "none" },
			monsters: ["wolf"],
		},
	],
	quests: [],
	events: [],
	balance: {
		skillRateK: 0,
		xpBase: 15,
		xpExponent: 1.4,
		tradingDiscountPerLevel: 0.02,
		tradingDiscountMax: 0.4,
		marketDriftRange: 0.3,
		marketDriftIntervalSec: 300,
		maxTickSec: 3600,
		maxTickPerDaySec: 86400,
		offlineCapSec: 120,
		rateBase: { chopping: 60 },
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

function state(overrides: Partial<GameState> = {}): GameState {
	const base = createInitialState("p1", 7, 1000);
	return { ...base, ...overrides };
}

function run(before: GameState, seconds: number): GameState {
	const now = before.lastTickAt + seconds;
	return tick(before, { content: CONTENT, now });
}

function start(
	before: GameState,
	command: Parameters<typeof startAction>[2],
): GameState {
	const result = startAction(before, CONTENT, command, before.lastTickAt);
	assert.equal(result.isErr(), false);
	if (result.isErr()) throw result.error;
	return result.value;
}

function cancel(before: GameState): GameState {
	const result = cancelAction(before, before.lastTickAt);
	assert.equal(result.isErr(), false);
	if (result.isErr()) throw result.error;
	return result.value;
}

test("cancelling a craft keeps its progress on the shelf", () => {
	const started = start(state({ inventory: { wood: 2 } }), {
		kind: "craft",
		recipeId: "make_plank",
	});
	const worked = run(started, 4);
	const paused = cancel(worked);
	assert.equal(paused.activeAction, null);
	assert.equal(paused.pausedActions.length, 1);
	const shelf = paused.pausedActions[0];
	assert.equal(shelf?.kind, "craft");
	assert.equal(shelf?.targetId, "make_plank");
	assert.equal(shelf?.kind === "craft" ? shelf.progress : -1, 4);
});

test("a paused action does not progress while it waits", () => {
	const started = start(state({ inventory: { wood: 2 } }), {
		kind: "craft",
		recipeId: "make_plank",
	});
	const paused = cancel(run(started, 4));
	const later = run(paused, 60);
	const shelf = later.pausedActions[0];
	assert.equal(shelf?.kind === "craft" ? shelf.progress : -1, 4);
	assert.equal(later.inventory.plank ?? 0, 0);
});

test("starting the same action again continues where it stopped", () => {
	const started = start(state({ inventory: { wood: 2 } }), {
		kind: "craft",
		recipeId: "make_plank",
	});
	const paused = cancel(run(started, 4));
	const resumed = start(paused, { kind: "craft", recipeId: "make_plank" });
	assert.equal(resumed.pausedActions.length, 0);
	assert.equal(
		resumed.activeAction?.kind === "craft" ? resumed.activeAction.progress : -1,
		4,
	);
	const done = run(resumed, 6);
	assert.equal(done.inventory.plank ?? 0, 1);
});

test("a different action does not resume the shelf entry", () => {
	const started = start(state({ inventory: { wood: 2 } }), {
		kind: "craft",
		recipeId: "make_plank",
	});
	const paused = cancel(run(started, 4));
	const other = start(paused, {
		kind: "gather",
		skill: "chopping",
		targetId: "wood",
	});
	assert.equal(other.activeAction?.kind, "gather");
	assert.equal(
		other.activeAction?.kind === "gather" ? other.activeAction.progress : -1,
		0,
	);
	assert.equal(other.pausedActions.length, 1);
});

test("cancelling a fight keeps the monster's hp", () => {
	const started = start(state(), { kind: "fight", monsterId: "wolf" });
	const fought = run(started, 5);
	const paused = cancel(fought);
	const shelf = paused.pausedActions[0];
	assert.equal(shelf?.kind, "fight");
	assert.equal(shelf?.kind === "fight" ? shelf.monsterHpLeft : -1, 50);
	const resumed = start(paused, { kind: "fight", monsterId: "wolf" });
	assert.equal(
		resumed.activeAction?.kind === "fight"
			? resumed.activeAction.monsterHpLeft
			: -1,
		50,
	);
});

test("the shelf holds at most three actions and drops the oldest", () => {
	let current = state({ inventory: { wood: 2 } });
	current = start(current, { kind: "craft", recipeId: "make_plank" });
	current = cancel(run(current, 1));
	current = start(current, {
		kind: "gather",
		skill: "chopping",
		targetId: "wood",
	});
	current = cancel(run(current, 1));
	current = start(current, {
		kind: "gather",
		skill: "mining",
		targetId: "stone",
	});
	current = cancel(run(current, 1));
	current = start(current, { kind: "fight", monsterId: "wolf" });
	current = cancel(run(current, 1));
	assert.equal(current.pausedActions.length, 3);
	current = start(current, {
		kind: "gather",
		skill: "magic",
		targetId: "herb",
	});
	current = cancel(run(current, 1));
	assert.equal(current.pausedActions.length, 3);
	const targets = current.pausedActions.map((action) => action.targetId);
	assert.equal(targets.includes("make_plank"), false);
	assert.deepEqual(targets.sort(), ["herb", "stone", "wolf"]);
});

test("discard throws the shelf away", () => {
	const started = start(state({ inventory: { wood: 2 } }), {
		kind: "craft",
		recipeId: "make_plank",
	});
	const paused = cancel(run(started, 4));
	const empty = discardPausedActions(paused, paused.lastTickAt);
	assert.equal(empty.pausedActions.length, 0);
});

test("discard with a target drops only that action", () => {
	let current = start(state({ inventory: { wood: 2 } }), {
		kind: "craft",
		recipeId: "make_plank",
	});
	current = cancel(run(current, 1));
	current = start(current, {
		kind: "gather",
		skill: "chopping",
		targetId: "wood",
	});
	current = cancel(run(current, 1));
	const trimmed = discardPausedActions(
		current,
		current.lastTickAt,
		"make_plank",
	);
	assert.equal(trimmed.pausedActions.length, 1);
	assert.equal(trimmed.pausedActions[0]?.targetId, "wood");
});

test("an old save without a shelf is migrated", () => {
	const legacy = state();
	const broken = {
		...legacy,
		version: 7,
		pausedActions: undefined,
	} as unknown as GameState;
	const migrated = migrateState(broken, CONTENT);
	assert.deepEqual(migrated.pausedActions, []);
});
