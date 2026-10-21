import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SKILL_IDS,
  type GameState,
} from "../../src/domain/game/types.ts";
import {
  STATE_VERSION,
  createInitialState,
  withInventory,
  withUpgrade,
  withWallet,
} from "../../src/domain/game/state.ts";

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

test("initial state has all eight skills at level 1", () => {
  const state = base();
  assert.equal(SKILL_IDS.length, 8);
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
