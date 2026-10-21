import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SKILL_IDS } from "../../src/domain/game/types.ts";
import { itemsFileSchema, recipesFileSchema, skillsFileSchema } from "../../src/infrastructure/content/schemas.ts";

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
