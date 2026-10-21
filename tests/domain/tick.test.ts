import { test } from "node:test";
import assert from "node:assert/strict";
import { tick } from "../../src/domain/game/tick.ts";
import { createInitialState } from "../../src/domain/game/state.ts";
import type { GameContent } from "../../src/domain/content/types.ts";
import type { ActiveAction, GameState } from "../../src/domain/game/types.ts";

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
  items: [],
  recipes: [
    {
      id: "make_plank",
      output: { item: "plank", qty: 1 },
      inputs: [],
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
      effect: { kind: "productionMultiplier", skill: "chopping", valuePerLevel: 0.1 },
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
  monsters: [
    {
      id: "wolf",
      name: "Волк",
      zone: "forest",
      hp: 10,
      damage: 1,
      attackInterval: 5,
      xp: 20,
      dropTable: [{ item: "pelt", chance: 1, qty: 1 }],
    },
  ],
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
    costGrowth: { axe: 1.15, bank: 1.35 },
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

function gatherAction(targetId = "wood"): ActiveAction {
  return {
    kind: "gather",
    skill: "chopping",
    targetId,
    startedAt: 1000,
    endsAt: 1000 + 60,
    progress: 0,
  };
}

test("tick without elapsed time changes nothing", () => {
  const before = state();
  const after = tick(before, { content: CONTENT, now: 1000 });
  assert.equal(after, before);
});

test("gathering produces items and xp over time", () => {
  const before = state({ activeAction: gatherAction() });
  const after = tick(before, { content: CONTENT, now: 1600 });
  assert.equal(after.inventory.wood, 11);
  assert.equal(after.skills.chopping?.xp, 11);
  assert.equal(after.lastTickAt, 1600);
});

test("gather rate grows with upgrade levels", () => {
  const before = state({ activeAction: gatherAction(), upgrades: { axe: 5 } });
  const after = tick(before, { content: CONTENT, now: 1600 });
  assert.equal(after.inventory.wood, 16);
});

test("crafting produces the recipe output over time", () => {
  const before = state({
    activeAction: {
      kind: "craft",
      skill: "crafting",
      targetId: "make_plank",
      startedAt: 1000,
      endsAt: 2000,
      progress: 0,
    },
  });
  const after = tick(before, { content: CONTENT, now: 1060 });
  assert.equal(after.inventory.plank, 6);
});

test("passive income adds gold", () => {
  const before = state({ upgrades: { bank: 2 } });
  const after = tick(before, { content: CONTENT, now: 1100 });
  assert.equal(after.wallet.gold, 100);
});

test("offline progress is capped by offlineCapSec", () => {
  const before = state({ activeAction: gatherAction() });
  const after = tick(before, { content: CONTENT, now: 1000 + 100000 });
  const expected = Math.floor((43200 / 60) * 1 * 1.1);
  assert.equal(after.inventory.wood, expected);
});

test("fighting a monster grants xp and drops when it dies", () => {
  const before = state({
    activeAction: {
      kind: "fight",
      skill: "combat",
      targetId: "wolf",
      startedAt: 1000,
      endsAt: 2000,
      progress: 0,
    },
  });
  const after = tick(before, { content: CONTENT, now: 1010 });
  assert.equal(after.activeAction, null);
  assert.equal(after.inventory.pelt, 1);
  assert.equal(after.skills.combat?.level, 2);
  assert.equal(after.skills.combat?.xp, 5);
});

test("player death ends the fight and restores health", () => {
  const before = state({
    activeAction: {
      kind: "fight",
      skill: "combat",
      targetId: "wolf",
      startedAt: 1000,
      endsAt: 2000,
      progress: 0,
    },
    health: { hp: 1, maxHp: 100 },
  });
  const after = tick(before, { content: CONTENT, now: 1100 });
  assert.equal(after.activeAction, null);
  assert.equal(after.health.hp, 100);
});

test("expired events are dropped and active events boost production", () => {
  const withEvent = state({
    activeAction: gatherAction(),
    activeEvents: [
      { id: "fair", startedAt: 1000, endsAt: 2000 },
      { id: "fair", startedAt: 1000, endsAt: 1500 },
    ],
  });
  const after = tick(withEvent, { content: CONTENT, now: 1600 });
  assert.equal(after.activeEvents.length, 1);
  assert.equal(after.inventory.wood, 22);
});

test("tick is deterministic for the same seed", () => {
  const a = tick(state({ activeAction: gatherAction() }), {
    content: CONTENT,
    now: 1060,
  });
  const b = tick(state({ activeAction: gatherAction() }), {
    content: CONTENT,
    now: 1060,
  });
  assert.deepEqual(a, b);
});

test("tick does not mutate the input state", () => {
  const before = state({ activeAction: gatherAction() });
  const snapshot = JSON.stringify(before);
  tick(before, { content: CONTENT, now: 1060 });
  assert.equal(JSON.stringify(before), snapshot);
});
