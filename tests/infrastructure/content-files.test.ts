import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SKILL_IDS } from "../../src/domain/game/types.ts";
import { skillsFileSchema } from "../../src/infrastructure/content/schemas.ts";

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
