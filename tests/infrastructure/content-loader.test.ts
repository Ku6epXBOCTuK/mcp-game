import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileContentRepository } from "../../src/infrastructure/content/loader.ts";
import type { DomainError } from "../../src/domain/shared/errors.ts";
import type {
	ContentSchemaMatchesDomain,
	UpgradesSchemaMatchesDomain,
} from "../../src/infrastructure/content/schemas.ts";

const VALID = {
	"skills.json": [
		{
			id: "chopping",
			name: "Р СѓР±РєР°",
			description: "СЂСѓР±РёС‚СЊ РґРµСЂРµРІСЊСЏ",
			xpCurve: { base: 15, exponent: 1.4 },
			unlockLevel: 1,
			icon: "axe",
		},
	],
	"items.json": [
		{
			id: "wood",
			name: "Р”РµСЂРµРІРѕ",
			type: "resource",
			sellPrice: 2,
			buyPrice: 4,
		},
		{
			id: "plank",
			name: "Р”РѕСЃРєР°",
			type: "material",
			sellPrice: 6,
			buyPrice: 12,
		},
	],
	"recipes.json": [
		{
			id: "make_plank",
			output: { item: "plank", qty: 1 },
			inputs: [{ item: "wood", qty: 2 }],
			skill: "crafting",
			skillLevel: 1,
			timeSec: 3,
		},
	],
	"upgrades.json": [
		{
			id: "axe",
			name: "РўРѕРїРѕСЂ",
			maxLevel: 10,
			costBase: 100,
			costGrowth: 1.15,
			effect: {
				kind: "productionMultiplier",
				skill: "chopping",
				valuePerLevel: 0.1,
			},
		},
	],
	"monsters.json": [
		{
			id: "wolf",
			name: "Р’РѕР»Рє",
			zone: "forest",
			hp: 10,
			damage: 2,
			attackInterval: 1.5,
			xp: 5,
			dropTable: [{ item: "wood", chance: 0.5, qty: 1 }],
		},
	],
	"zones.json": [
		{
			id: "forest",
			name: "Р›РµСЃ",
			unlock: { kind: "none" },
			monsters: ["wolf"],
		},
	],
	"quests.json": [
		{
			id: "q1",
			name: "РџРµСЂРІС‹Рµ РґСЂРѕРІР°",
			steps: [{ kind: "collect", target: "wood", qty: 10 }],
			rewards: [{ kind: "gold", id: "gold", qty: 50 }],
		},
	],
	"events.json": [
		{
			id: "fair",
			name: "РЇСЂРјР°СЂРєР°",
			durationSec: 600,
			modifiers: [{ kind: "goldMultiplier", value: 1.5 }],
			weight: 1,
		},
	],
	"balance.json": {
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
		prestigeProductionExponent: 0.15,
		prestigeGoldExponent: 0.2,
		eventChancePerMinute: 0.02,
		playerMaxHp: 100,
		playerDamageBase: 1,
		playerDamagePerLevel: 0.5,
	},
} as const;

type ValidFiles = keyof typeof VALID;

function expectContentError(error: DomainError): {
	code: "ContentInvalid";
	message: string;
	path: string;
	id: string;
	detail: string;
} {
	assert.equal(error.code, "ContentInvalid");
	if (error.code !== "ContentInvalid") throw new Error("not a content error");
	return error;
}

async function makeContentDir(
	overrides: Partial<Record<string, unknown>> = {},
): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "mcp-content-"));
	for (const name of Object.keys(VALID) as ValidFiles[]) {
		const value = name in overrides ? overrides[name] : VALID[name];
		await writeFile(join(dir, name), JSON.stringify(value, null, 2), "utf8");
	}
	return dir;
}

test("valid content loads", async () => {
	const dir = await makeContentDir();
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isOk(), true);
	if (result.isOk()) {
		assert.equal(result.value.items.length, 2);
		assert.equal(result.value.balance.skillRateK, 0.1);
		assert.equal(result.value.zones[0]?.monsters[0], "wolf");
	}
	await rm(dir, { recursive: true, force: true });
});

test("missing file produces ContentInvalid with path", async () => {
	const dir = await makeContentDir();
	await rm(join(dir, "items.json"));
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(result.error.code, "ContentInvalid");
		assert.equal(expectContentError(result.error).id, "items.json");
		assert.match(result.error.message, /items\.json/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("broken json produces ContentInvalid", async () => {
	const dir = await makeContentDir();
	await writeFile(join(dir, "items.json"), "{ not json", "utf8");
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(result.error.code, "ContentInvalid");
		assert.match(expectContentError(result.error).detail, /JSON/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("invalid shape produces ContentInvalid with field path", async () => {
	const dir = await makeContentDir({
		"items.json": [
			{
				id: "wood",
				name: "Р”РµСЂРµРІРѕ",
				type: "weapon",
				sellPrice: 2,
				buyPrice: 4,
			},
		],
	});
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(result.error.code, "ContentInvalid");
		assert.match(expectContentError(result.error).detail, /type/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("unknown item reference in a recipe is rejected", async () => {
	const dir = await makeContentDir({
		"recipes.json": [
			{
				id: "make_plank",
				output: { item: "missing", qty: 1 },
				inputs: [{ item: "wood", qty: 2 }],
				skill: "crafting",
				skillLevel: 1,
				timeSec: 3,
			},
		],
	});
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(result.error.code, "ContentInvalid");
		assert.equal(expectContentError(result.error).id, "make_plank");
		assert.match(expectContentError(result.error).detail, /missing/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("unknown monster reference in a zone is rejected", async () => {
	const dir = await makeContentDir({
		"zones.json": [
			{
				id: "forest",
				name: "Р›РµСЃ",
				unlock: { kind: "none" },
				monsters: ["dragon"],
			},
		],
	});
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(expectContentError(result.error).id, "forest");
		assert.match(expectContentError(result.error).detail, /dragon/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("quest unlock pointing to a missing quest is rejected", async () => {
	const dir = await makeContentDir({
		"zones.json": [
			{
				id: "forest",
				name: "Р›РµСЃ",
				unlock: { kind: "quest", quest: "q_missing" },
				monsters: ["wolf"],
			},
		],
	});
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(expectContentError(result.error).id, "forest");
		assert.match(expectContentError(result.error).detail, /q_missing/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("unknown drop item in a monster is rejected", async () => {
	const dir = await makeContentDir({
		"monsters.json": [
			{
				id: "wolf",
				name: "Волк",
				zone: "forest",
				hp: 10,
				damage: 2,
				attackInterval: 1.5,
				xp: 5,
				dropTable: [{ item: "gold_ore", chance: 0.5, qty: 1 }],
			},
		],
	});
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(expectContentError(result.error).id, "wolf");
		assert.match(expectContentError(result.error).detail, /gold_ore/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("unknown zone of a monster is rejected", async () => {
	const dir = await makeContentDir({
		"monsters.json": [
			{
				id: "wolf",
				name: "Волк",
				zone: "void",
				hp: 10,
				damage: 2,
				attackInterval: 1.5,
				xp: 5,
				dropTable: [{ item: "wood", chance: 0.5, qty: 1 }],
			},
		],
	});
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(expectContentError(result.error).id, "wolf");
		assert.match(expectContentError(result.error).detail, /void/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("unknown quest reward item is rejected", async () => {
	const dir = await makeContentDir({
		"quests.json": [
			{
				id: "q1",
				name: "Первое дерево",
				steps: [{ kind: "collect", target: "wood", qty: 10 }],
				rewards: [{ kind: "item", id: "magic_wand", qty: 1 }],
			},
		],
	});
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(expectContentError(result.error).id, "q1");
		assert.match(expectContentError(result.error).detail, /magic_wand/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("unknown quest step recipe is rejected", async () => {
	const dir = await makeContentDir({
		"quests.json": [
			{
				id: "q1",
				name: "Первое дерево",
				steps: [{ kind: "craft", target: "make_bow", qty: 1 }],
				rewards: [{ kind: "gold", id: "gold", qty: 50 }],
			},
		],
	});
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(expectContentError(result.error).id, "q1");
		assert.match(expectContentError(result.error).detail, /make_bow/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("unknown skill in balance.rateBase is rejected", async () => {
	const dir = await makeContentDir({
		"balance.json": {
			...VALID["balance.json"],
			rateBase: { chopping: 1, sailing: 0.5 },
		},
	});
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(expectContentError(result.error).id, "rateBase");
		assert.match(expectContentError(result.error).detail, /sailing/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("unknown upgrade in balance.costGrowth is rejected", async () => {
	const dir = await makeContentDir({
		"balance.json": {
			...VALID["balance.json"],
			costGrowth: { axe: 1.15, moon_tower: 1.4 },
		},
	});
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(expectContentError(result.error).id, "costGrowth");
		assert.match(expectContentError(result.error).detail, /moon_tower/);
	}
	await rm(dir, { recursive: true, force: true });
});

test("content files with a BOM are parsed", async () => {
	const dir = await makeContentDir();
	await writeFile(
		join(dir, "items.json"),
		`\uFEFF${JSON.stringify(VALID["items.json"])}`,
		"utf8",
	);
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isOk(), true);
	if (result.isOk()) {
		assert.equal(result.value.items.length, 2);
	}
	await rm(dir, { recursive: true, force: true });
});

test("loaded content is cached until invalidate", async () => {
	const dir = await makeContentDir();
	const repo = new FileContentRepository(dir);
	const first = await repo.load();
	await writeFile(
		join(dir, "items.json"),
		JSON.stringify([
			...VALID["items.json"],
			{
				id: "stone",
				name: "Камень",
				type: "resource",
				sellPrice: 1,
				buyPrice: 2,
			},
		]),
		"utf8",
	);
	const second = await repo.load();
	assert.equal(first.isOk() && second.isOk() && second.value.items.length, 2);
	repo.invalidate();
	const third = await repo.load();
	assert.equal(third.isOk() && third.value.items.length, 3);
	await rm(dir, { recursive: true, force: true });
});

test("empty content directory is reported instead of crashing", async () => {
	const dir = await mkdtemp(join(tmpdir(), "mcp-content-empty-"));
	await mkdir(dir, { recursive: true });
	const repo = new FileContentRepository(dir);
	const result = await repo.load();
	assert.equal(result.isErr(), true);
	await rm(dir, { recursive: true, force: true });
});

test("schema types match the domain content types", () => {
	const upgrades: UpgradesSchemaMatchesDomain = true;
	const content: ContentSchemaMatchesDomain = true;
	assert.equal(upgrades, true);
	assert.equal(content, true);
});
