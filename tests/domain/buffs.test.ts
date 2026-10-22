import { test } from "vitest";
import assert from "node:assert/strict";
import { useItem } from "../../src/domain/game/health.ts";
import { startAction } from "../../src/domain/game/actions.ts";
import { tick } from "../../src/domain/game/tick.ts";
import { createInitialState } from "../../src/domain/game/state.ts";
import { playerDpsFor } from "../../src/domain/game/combat.ts";
import type { GameContent } from "../../src/domain/content/types.ts";
import type { GameState } from "../../src/domain/game/types.ts";

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
			id: "potion_strength",
			name: "Зелье силы",
			type: "material",
			sellPrice: 45,
			buyPrice: 90,
		},
		{
			id: "elixir",
			name: "Эликсир",
			type: "material",
			sellPrice: 90,
			buyPrice: 180,
		},
	],
	recipes: [],
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
		{
			id: "ogre",
			name: "Огр",
			zone: "meadow",
			hp: 100,
			damage: 100,
			attackInterval: 5,
			xp: 20,
			dropTable: [],
		},
	],
	zones: [
		{
			id: "meadow",
			name: "Луг",
			unlock: { kind: "none" },
			monsters: ["wolf", "ogre"],
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
		offlineCapSec: 120,
		rateBase: {},
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
		potionStrengthDamageMultiplier: 1.5,
		elixirDamageMultiplier: 2,
	},
};

function state(overrides: Partial<GameState> = {}): GameState {
	const base = createInitialState("p1", 42, 1000);
	return { ...base, ...overrides };
}

function startFight(before: GameState, monsterId: string): GameState {
	const result = startAction(
		before,
		CONTENT,
		{ kind: "fight", monsterId },
		1000,
	);
	assert.equal(result.isErr(), false);
	if (result.isErr()) throw result.error;
	return result.value;
}

test("a strength potion outside a fight waits for the next fight", () => {
	const before = state({ inventory: { potion_strength: 2 } });
	const result = useItem(before, CONTENT, "potion_strength", 1000);
	assert.equal(result.isErr(), false);
	if (result.isErr()) return;
	assert.equal(result.value.inventory.potion_strength, 1);
	assert.equal(result.value.combatBuffs.length, 1);
	assert.equal(result.value.combatBuffs[0]?.damageMultiplier, 1.5);
});

test("the next fight consumes the buff and doubles the damage", () => {
	const before = state({ inventory: { potion_strength: 1 } });
	const used = useItem(before, CONTENT, "potion_strength", 1000);
	assert.equal(used.isErr(), false);
	if (used.isErr()) return;
	const started = startFight(used.value, "wolf");
	const action = started.activeAction;
	assert.equal(action?.kind, "fight");
	assert.equal(action?.kind === "fight" ? action.damageMultiplier : null, 1.5);
	assert.equal(started.combatBuffs.length, 0);
});

test("the buff changes how fast the monster dies", () => {
	const plain = tick(startFight(state(), "wolf"), {
		content: CONTENT,
		now: 1000 + 8,
	});
	assert.equal(plain.activeAction?.kind, "fight");
	assert.equal(
		plain.activeAction?.kind === "fight" ? plain.activeAction.monsterHpLeft : 0,
		20,
	);
	const buffed = tick(
		startFight(
			(() => {
				const used = useItem(
					state({ inventory: { potion_strength: 1 } }),
					CONTENT,
					"potion_strength",
					1000,
				);
				assert.equal(used.isErr(), false);
				if (used.isErr()) throw used.error;
				return used.value;
			})(),
			"wolf",
		),
		{ content: CONTENT, now: 1000 + 8 },
	);
	assert.equal(buffed.activeAction, null);
	assert.equal(buffed.counters.killed.wolf, 1);
});

test("a strength potion during a fight boosts the running fight", () => {
	const fighting = state({
		activeAction: {
			kind: "fight",
			skill: "combat",
			targetId: "wolf",
			startedAt: 1000,
			endsAt: 1000,
			monsterHpLeft: 100,
			monsterHitInSec: 5,
		},
		inventory: { potion_strength: 1 },
	});
	const result = useItem(fighting, CONTENT, "potion_strength", 1000);
	assert.equal(result.isErr(), false);
	if (result.isErr()) return;
	const action = result.value.activeAction;
	assert.equal(action?.kind, "fight");
	assert.equal(action?.kind === "fight" ? action.damageMultiplier : null, 1.5);
	assert.equal(result.value.combatBuffs.length, 0);
});

test("the elixir heals to full and doubles the damage", () => {
	const before = state({
		health: { hp: 20, maxHp: 100 },
		inventory: { elixir: 1 },
	});
	const result = useItem(before, CONTENT, "elixir", 1000);
	assert.equal(result.isErr(), false);
	if (result.isErr()) return;
	assert.equal(result.value.health.hp, 100);
	assert.equal(result.value.combatBuffs[0]?.damageMultiplier, 2);
});

test("the policy drinks an elixir when it turns a lost fight into a win", () => {
	const before = state({
		health: { hp: 50, maxHp: 100 },
		inventory: { elixir: 1 },
		combatPolicy: {
			potionAtHpPercent: null,
			fleeAtHpPercent: null,
			autoRepeat: false,
			strengthPotionWhenLosing: true,
		},
	});
	const started = startFight(before, "ogre");
	const action = started.activeAction;
	assert.equal(action?.kind === "fight" ? action.damageMultiplier : null, 2);
	assert.equal(started.inventory.elixir, undefined);
	assert.equal(started.health.hp, 100);
});

test("the policy keeps the potion when the fight stays lost", () => {
	const before = state({
		inventory: { potion_strength: 1 },
		combatPolicy: {
			potionAtHpPercent: null,
			fleeAtHpPercent: null,
			autoRepeat: false,
			strengthPotionWhenLosing: true,
		},
	});
	const started = startFight(before, "ogre");
	const action = started.activeAction;
	assert.equal(action?.kind === "fight" ? action.damageMultiplier : null, 1);
	assert.equal(started.inventory.potion_strength, 1);
});

test("the damage forecast follows the buff", () => {
	const before = state();
	assert.equal(playerDpsFor(before, CONTENT, 1), 10);
	assert.equal(playerDpsFor(before, CONTENT, 1.5), 15);
});
