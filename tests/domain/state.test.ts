import { test } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";
import { SKILL_IDS, type GameState } from "../../src/domain/game/types.ts";
import {
	STATE_VERSION,
	createInitialState,
	migrateState,
	withInventory,
	withUpgrade,
	withWallet,
} from "../../src/domain/game/state.ts";
import { FileContentRepository } from "../../src/infrastructure/content/loader.ts";

function base(): GameState {
	return createInitialState("player-1", 12345, 1000);
}

test("initial state has version, player and empty economy", () => {
	const state = base();
	assert.equal(state.version, STATE_VERSION);
	assert.equal(state.playerId, "player-1");
	assert.equal(state.createdAt, 1000);
	assert.equal(state.lastTickAt, 1000);
	assert.deepEqual(state.wallet, { gold: 0, credits: 0 });
	assert.deepEqual(state.inventory, {});
	assert.deepEqual(state.upgrades, {});
	assert.equal(state.activeAction, null);
	assert.equal(state.prestige.runs, 0);
	assert.deepEqual(state.rng, { seed: 12345, counter: 0 });
});

test("initial state has every skill at level 1", () => {
	const state = base();
	assert.deepEqual(Object.keys(state.skills).sort(), [...SKILL_IDS].sort());
	for (const id of SKILL_IDS) {
		assert.equal(state.skills[id].level, 1);
		assert.equal(state.skills[id].xp, 0);
	}
});

test("updates never mutate the previous state", () => {
	const state = base();
	const walleted = withWallet(state, { gold: 10 });
	const stocked = withInventory(walleted, "wood", 5);
	const upgraded = withUpgrade(stocked, "axe", 2);

	assert.equal(state.wallet.gold, 0);
	assert.equal(walleted.wallet.gold, 10);
	assert.equal(walleted.inventory.wood, undefined);
	assert.equal(stocked.inventory.wood, 5);
	assert.equal(stocked.upgrades.axe, undefined);
	assert.equal(upgraded.upgrades.axe, 2);
	assert.notEqual(state, walleted);
	assert.notEqual(walleted, stocked);
});

test("inventory drops entries that reach zero", () => {
	const state = withInventory(base(), "wood", 2);
	const emptied = withInventory(state, "wood", -2);
	assert.equal("wood" in emptied.inventory, false);
});

test("initial counters include the bought ledger", () => {
	const state = base();
	assert.deepEqual(state.counters.bought, {});
});

test("migration backfills the bought counter", async () => {
	const repo = new FileContentRepository(
		join(import.meta.dirname, "..", "..", "content"),
	);
	const contentResult = await repo.load();
	assert.equal(contentResult.isOk(), true);
	if (!contentResult.isOk()) return;
	const legacy = {
		...base(),
		version: STATE_VERSION - 1,
		counters: {
			gathered: { wood: 5 },
			crafted: {},
			craftedItems: {},
			killed: {},
		},
	} as unknown as GameState;
	const migrated = migrateState(legacy, contentResult.value);
	assert.equal(migrated.version, STATE_VERSION);
	assert.deepEqual(migrated.counters.bought, {});
	assert.equal(migrated.counters.gathered.wood, 5);
});
