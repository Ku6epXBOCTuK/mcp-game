import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SKILL_IDS } from "../../src/domain/game/types.ts";
import {
  DEFAULT_SKILL_RATE_K,
  MARKET_DRIFT_RANGE,
  MAX_TRADING_DISCOUNT,
  TRADING_DISCOUNT_PER_LEVEL,
} from "../../src/domain/shared/curves.ts";
import {
  balanceSchema,
  eventsFileSchema,
  itemsFileSchema,
  monstersFileSchema,
  questsFileSchema,
  recipesFileSchema,
  skillsFileSchema,
  upgradesFileSchema,
  zonesFileSchema,
} from "../../src/infrastructure/content/schemas.ts";

const contentDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "content",
);

async function readContent(name: string): Promise<unknown> {
  const text = await readFile(join(contentDir, name), "utf8");
  return JSON.parse(text) as unknown;
}

test("skills.json covers every skill id exactly once", async () => {
  const skills = skillsFileSchema.parse(await readContent("skills.json"));
  const ids = skills.map((skill) => skill.id);
  assert.deepEqual([...ids].sort(), [...SKILL_IDS].sort());
  assert.equal(new Set(ids).size, ids.length);
});

test("items.json has unique ids and covers every item type", async () => {
  const items = itemsFileSchema.parse(await readContent("items.json"));
  const ids = items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  const types = new Set(items.map((item) => item.type));
  assert.deepEqual(
    [...types].sort(),
    ["food", "material", "quest", "resource", "tool"],
  );
  assert.ok(items.length >= 50);
});

test("items.json keeps prices sane", async () => {
  const items = itemsFileSchema.parse(await readContent("items.json"));
  for (const item of items) {
    assert.ok(item.sellPrice >= 0);
    assert.ok(item.buyPrice >= item.sellPrice, `${item.id} buy < sell`);
    if (item.type === "quest") {
      assert.equal(item.buyPrice, 0, `${item.id} квестовый предмет должен быть нерабочим`);
    }
  }
});

test("recipes.json covers every skill and only references known items", async () => {
  const recipes = recipesFileSchema.parse(await readContent("recipes.json"));
  const items = itemsFileSchema.parse(await readContent("items.json"));
  const itemIds = new Set(items.map((item) => item.id));
  const skills = new Set(recipes.map((recipe) => recipe.skill));
  assert.deepEqual(
    [...skills].sort(),
    ["chopping", "cooking", "crafting", "hunting", "magic", "mining"].sort(),
  );
  for (const recipe of recipes) {
    assert.ok(itemIds.has(recipe.output.item), `${recipe.id} -> ${recipe.output.item}`);
    for (const input of recipe.inputs) {
      assert.ok(itemIds.has(input.item), `${recipe.id} <- ${input.item}`);
    }
    assert.ok(recipe.skillLevel >= 1);
    assert.ok(recipe.timeSec > 0);
  }
  assert.equal(new Set(recipes.map((r) => r.id)).size, recipes.length);
  assert.ok(recipes.length >= 40);
});

test("upgrades.json defines the planned building set with sane curves", async () => {
  const upgrades = upgradesFileSchema.parse(await readContent("upgrades.json"));
  assert.equal(upgrades.length, 12);
  assert.equal(
    new Set(upgrades.map((upgrade) => upgrade.id)).size,
    upgrades.length,
  );
  for (const upgrade of upgrades) {
    assert.ok(upgrade.maxLevel >= 1);
    assert.ok(upgrade.costBase > 0);
    assert.ok(upgrade.costGrowth >= 1);
    if (upgrade.effect.kind === "unlock") {
      assert.ok(upgrade.effect.feature.length > 0);
    } else {
      assert.ok(upgrade.effect.valuePerLevel > 0);
    }
  }
  const kinds = new Set(upgrades.map((upgrade) => upgrade.effect.kind));
  assert.deepEqual(
    [...kinds].sort(),
    ["passiveIncome", "productionMultiplier", "unlock", "xpMultiplier"],
  );
});

test("zones.json defines 8 zones with monsters from monsters.json", async () => {
  const zones = zonesFileSchema.parse(await readContent("zones.json"));
  const monsters = monstersFileSchema.parse(await readContent("monsters.json"));
  const monsterIds = new Set(monsters.map((monster) => monster.id));
  assert.equal(zones.length, 8);
  assert.equal(new Set(zones.map((zone) => zone.id)).size, zones.length);
  for (const zone of zones) {
    assert.ok(zone.monsters.length > 0);
    for (const monsterId of zone.monsters) {
      assert.ok(monsterIds.has(monsterId), `${zone.id} -> ${monsterId}`);
    }
    if (zone.unlock.kind === "skillLevel") {
      assert.ok(zone.unlock.level >= 1);
    }
    if (zone.unlock.kind === "quest") {
      assert.ok(zone.unlock.quest.length > 0);
    }
  }
});

test("monsters.json has sane combat stats and only known drops", async () => {
  const monsters = monstersFileSchema.parse(await readContent("monsters.json"));
  const items = itemsFileSchema.parse(await readContent("items.json"));
  const itemIds = new Set(items.map((item) => item.id));
  assert.equal(new Set(monsters.map((monster) => monster.id)).size, monsters.length);
  for (const monster of monsters) {
    assert.ok(monster.hp > 0);
    assert.ok(monster.damage > 0);
    assert.ok(monster.attackInterval > 0);
    assert.ok(monster.xp > 0);
    assert.ok(monster.dropTable.length > 0);
    for (const drop of monster.dropTable) {
      assert.ok(itemIds.has(drop.item), `${monster.id} -> ${drop.item}`);
      assert.ok(drop.chance > 0 && drop.chance <= 1);
    }
  }
});

test("quests.json has 10 chains referencing known content", async () => {
  const quests = questsFileSchema.parse(await readContent("quests.json"));
  const items = itemsFileSchema.parse(await readContent("items.json"));
  const recipes = recipesFileSchema.parse(await readContent("recipes.json"));
  const monsters = monstersFileSchema.parse(await readContent("monsters.json"));
  const upgrades = upgradesFileSchema.parse(await readContent("upgrades.json"));
  const itemIds = new Set(items.map((item) => item.id));
  const recipeIds = new Set(recipes.map((recipe) => recipe.id));
  const monsterIds = new Set(monsters.map((monster) => monster.id));
  const upgradeIds = new Set(upgrades.map((upgrade) => upgrade.id));

  assert.equal(quests.length, 10);
  assert.equal(new Set(quests.map((quest) => quest.id)).size, quests.length);

  for (const quest of quests) {
    assert.ok(quest.steps.length > 0);
    for (const step of quest.steps) {
      if (step.kind === "collect") assert.ok(itemIds.has(step.target), `${quest.id} -> ${step.target}`);
      if (step.kind === "craft") assert.ok(recipeIds.has(step.target), `${quest.id} -> ${step.target}`);
      if (step.kind === "kill") assert.ok(monsterIds.has(step.target), `${quest.id} -> ${step.target}`);
      if (step.kind === "level") assert.ok(SKILL_IDS.includes(step.target as never), `${quest.id} -> ${step.target}`);
      if (step.kind === "upgrade") assert.ok(upgradeIds.has(step.target), `${quest.id} -> ${step.target}`);
    }
    for (const reward of quest.rewards) {
      if (reward.kind === "item") assert.ok(itemIds.has(reward.id), `${quest.id} -> ${reward.id}`);
      if (reward.kind === "upgrade") assert.ok(upgradeIds.has(reward.id), `${quest.id} -> ${reward.id}`);
      if (reward.kind === "skillLevel") assert.ok(SKILL_IDS.includes(reward.id as never), `${quest.id} -> ${reward.id}`);
    }
  }
});

test("zones gated by quests point at existing quests", async () => {
  const zones = zonesFileSchema.parse(await readContent("zones.json"));
  const quests = questsFileSchema.parse(await readContent("quests.json"));
  const questIds = new Set(quests.map((quest) => quest.id));
  for (const zone of zones) {
    if (zone.unlock.kind === "quest") {
      assert.ok(questIds.has(zone.unlock.quest), `${zone.id} -> ${zone.unlock.quest}`);
    }
  }
});

test("events.json has 6 timed events with sane modifiers", async () => {
  const events = eventsFileSchema.parse(await readContent("events.json"));
  assert.equal(events.length, 6);
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  for (const event of events) {
    assert.ok(event.durationSec >= 300 && event.durationSec <= 900, event.id);
    assert.ok(event.weight > 0, event.id);
    assert.ok(event.modifiers.length > 0, event.id);
    for (const modifier of event.modifiers) {
      if (modifier.kind === "skillLevel") {
        assert.ok(modifier.target !== undefined, event.id);
        assert.ok(SKILL_IDS.includes(modifier.target as never), event.id);
        assert.ok(Number.isInteger(modifier.value), event.id);
      } else {
        assert.ok(modifier.value > 0, event.id);
      }
    }
  }
});

test("balance.json matches the domain curve defaults and covers all skills", async () => {
  const balance = balanceSchema.parse(await readContent("balance.json"));
  const skills = skillsFileSchema.parse(await readContent("skills.json"));
  const upgrades = upgradesFileSchema.parse(await readContent("upgrades.json"));

  assert.equal(balance.skillRateK, DEFAULT_SKILL_RATE_K);
  assert.equal(balance.xpBase, 15);
  assert.equal(balance.xpExponent, 1.4);
  assert.equal(balance.tradingDiscountPerLevel, TRADING_DISCOUNT_PER_LEVEL);
  assert.equal(balance.tradingDiscountMax, MAX_TRADING_DISCOUNT);
  assert.equal(balance.marketDriftRange, MARKET_DRIFT_RANGE);
  assert.equal(balance.marketDriftIntervalSec, 300);
  assert.equal(balance.maxTickSec, 3600);
  assert.equal(balance.maxTickPerDaySec, 86400);
  assert.equal(balance.offlineCapSec, 43200);

  assert.deepEqual(
    Object.keys(balance.rateBase).sort(),
    skills.map((skill) => skill.id).sort(),
  );
  assert.deepEqual(
    Object.keys(balance.costGrowth).sort(),
    upgrades.map((upgrade) => upgrade.id).sort(),
  );
  for (const upgrade of upgrades) {
    assert.equal(balance.costGrowth[upgrade.id], upgrade.costGrowth);
  }
});

test("skills.json uses the shared xp curve and sane unlock levels", async () => {
  const skills = skillsFileSchema.parse(await readContent("skills.json"));
  for (const skill of skills) {
    assert.equal(skill.xpCurve.base, 15);
    assert.equal(skill.xpCurve.exponent, 1.4);
    assert.ok(skill.unlockLevel >= 1);
    assert.ok(skill.name.length > 0);
    assert.ok(skill.description.length > 0);
    assert.ok(skill.icon.length > 0);
  }
});
