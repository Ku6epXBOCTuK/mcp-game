import { test } from "node:test";
import assert from "node:assert/strict";
import {
  balanceSchema,
  eventSchema,
  itemSchema,
  questSchema,
  recipeSchema,
  upgradeSchema,
  zoneSchema,
  monsterSchema,
  skillSchema,
} from "../../src/infrastructure/content/schemas.ts";

test("item accepts a full definition", () => {
  const parsed = itemSchema.parse({
    id: "wood",
    name: "Дерево",
    type: "resource",
    sellPrice: 2,
    buyPrice: 4,
  });
  assert.equal(parsed.id, "wood");
  assert.equal(parsed.type, "resource");
});

test("item rejects unknown type and negative price", () => {
  assert.equal(
    itemSchema.safeParse({ id: "x", name: "X", type: "weapon", sellPrice: 1, buyPrice: 1 }).success,
    false,
  );
  assert.equal(
    itemSchema.safeParse({ id: "x", name: "X", type: "resource", sellPrice: -1, buyPrice: 1 }).success,
    false,
  );
});

test("recipe accepts empty inputs (gathering) and rejects bad time", () => {
  const base = {
    id: "plank",
    output: { item: "plank", qty: 1 },
    skill: "crafting",
    skillLevel: 1,
    timeSec: 3,
  };
  assert.equal(recipeSchema.safeParse({ ...base, inputs: [] }).success, true);
  assert.equal(recipeSchema.safeParse({ ...base, timeSec: 0, inputs: [{ item: "wood", qty: 1 }] }).success, false);
  assert.equal(
    recipeSchema.safeParse({ ...base, inputs: [{ item: "wood", qty: 0 }] }).success,
    false,
  );
  assert.equal(
    recipeSchema.safeParse({ ...base, inputs: [{ item: "wood", qty: 1 }] }).success,
    true,
  );
});

test("upgrade effect is a discriminated union", () => {
  assert.equal(
    upgradeSchema.safeParse({
      id: "axe",
      name: "Топор",
      maxLevel: 10,
      costBase: 100,
      costGrowth: 1.15,
      effect: { kind: "productionMultiplier", skill: "chopping", valuePerLevel: 0.1 },
    }).success,
    true,
  );
  assert.equal(
    upgradeSchema.safeParse({
      id: "axe",
      name: "Топор",
      maxLevel: 10,
      costBase: 100,
      costGrowth: 1.15,
      effect: { kind: "unknownKind", valuePerLevel: 1 },
    }).success,
    false,
  );
});

test("zone unlock accepts quest, skillLevel and none", () => {
  const base = { id: "forest", name: "Лес", monsters: ["wolf"] };
  assert.equal(zoneSchema.safeParse({ ...base, unlock: { kind: "none" } }).success, true);
  assert.equal(zoneSchema.safeParse({ ...base, unlock: { kind: "quest", quest: "q1" } }).success, true);
  assert.equal(
    zoneSchema.safeParse({ ...base, unlock: { kind: "skillLevel", skill: "chopping", level: 5 } }).success,
    true,
  );
  assert.equal(zoneSchema.safeParse({ ...base, unlock: { kind: "quest" } }).success, false);
});

test("monster requires a drop table and non-negative chance", () => {
  const base = {
    id: "wolf",
    name: "Волк",
    zone: "forest",
    hp: 10,
    damage: 2,
    attackInterval: 1.5,
    xp: 5,
  };
  assert.equal(monsterSchema.safeParse({ ...base, dropTable: [] }).success, false);
  assert.equal(
    monsterSchema.safeParse({ ...base, dropTable: [{ item: "pelt", chance: 1.5, qty: 1 }] }).success,
    false,
  );
  assert.equal(
    monsterSchema.safeParse({ ...base, dropTable: [{ item: "pelt", chance: 0.5, qty: 1 }] }).success,
    true,
  );
});

test("quest steps and rewards are constrained", () => {
  assert.equal(
    questSchema.safeParse({ id: "q1", name: "Квест", steps: [], rewards: [] }).success,
    false,
  );
  assert.equal(
    questSchema.safeParse({
      id: "q1",
      name: "Квест",
      steps: [{ kind: "collect", target: "wood", qty: 10 }],
      rewards: [{ kind: "gold", id: "gold", qty: 50 }],
    }).success,
    true,
  );
});

test("event requires duration, modifiers and positive weight", () => {
  assert.equal(
    eventSchema.safeParse({
      id: "market",
      name: "Ярмарка",
      durationSec: 600,
      modifiers: [{ kind: "goldMultiplier", value: 1.5 }],
      weight: 1,
    }).success,
    true,
  );
  assert.equal(
    eventSchema.safeParse({
      id: "market",
      name: "Ярмарка",
      durationSec: 600,
      modifiers: [],
      weight: 1,
    }).success,
    false,
  );
});

test("balance requires the tuning knobs used by domain curves", () => {
  const parsed = balanceSchema.parse({
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
    costGrowth: { axe: 1.15 },
  });
  assert.equal(parsed.skillRateK, 0.1);
  assert.equal(parsed.offlineCapSec, 43200);
});

test("skill requires xp curve and unlock level", () => {
  assert.equal(
    skillSchema.safeParse({
      id: "chopping",
      name: "Рубка",
      description: "рубить деревья",
      xpCurve: { base: 15, exponent: 1.4 },
      unlockLevel: 1,
      icon: "axe",
    }).success,
    true,
  );
  assert.equal(
    skillSchema.safeParse({
      id: "chopping",
      name: "Рубка",
      description: "рубить деревья",
      xpCurve: { base: 15, exponent: 1.4 },
      unlockLevel: 0,
      icon: "axe",
    }).success,
    false,
  );
});
