import { test } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";
import { openMemoryDatabase } from "../../src/infrastructure/persistence/database.ts";
import { SqlitePlayerRepository } from "../../src/infrastructure/persistence/player-repository.ts";
import { SqliteGameRepository } from "../../src/infrastructure/persistence/game-repository.ts";
import { FileContentRepository } from "../../src/infrastructure/content/loader.ts";
import { GameService } from "../../src/application/use-cases/game-service.ts";
import { createMcpServerFactory } from "../../src/infrastructure/mcp/server.ts";
import { connectTestClient } from "../helpers/mcp-test-client.ts";

const CONTENT_DIR = join(import.meta.dirname, "..", "..", "content");

type Harness = {
	client: Awaited<ReturnType<typeof connectTestClient>>;
	db: ReturnType<typeof openMemoryDatabase>;
};

async function makeHarness(
	scopes: ("read" | "play")[] = ["read", "play"],
	now = 1_000_000,
): Promise<Harness> {
	const db = openMemoryDatabase();
	const service = new GameService({
		games: new SqliteGameRepository(db),
		players: new SqlitePlayerRepository(db),
		content: new FileContentRepository(CONTENT_DIR),
		clock: { now: () => now },
	});
	const factory = createMcpServerFactory({ games: service, dev: true });
	const server = factory({ playerId: "p1", scopes });
	const client = await connectTestClient(server);
	void factory;
	return { client, db };
}

async function callTool(
	client: Awaited<ReturnType<typeof connectTestClient>>,
	name: string,
	args: Record<string, unknown> = {},
): Promise<{ text: string; isError: boolean }> {
	const result = (await client.request("tools/call", {
		name,
		arguments: args,
	})) as {
		content?: { type: string; text: string }[];
		isError?: boolean;
	};
	const first = result.content?.[0];
	return { text: first?.text ?? "", isError: result.isError === true };
}

test("server exposes the planned tools", async () => {
	const { client, db } = await makeHarness();
	const result = (await client.request("tools/list")) as {
		tools: { name: string }[];
	};
	const names = result.tools.map((tool) => tool.name);
	for (const expected of [
		"game_action",
		"game_bank",
		"game_combat",
		"game_craft",
		"game_log",
		"game_market",
		"game_prestige",
		"game_quests",
		"game_skills",
		"game_state",
		"game_tick",
		"game_trade",
		"game_upgrades",
		"game_use",
	]) {
		assert.ok(names.includes(expected), `нет инструмента ${expected}`);
	}
	await client.close();
	db.close();
});

test("game_state returns the player snapshot", async () => {
	const { client, db } = await makeHarness();
	const { text, isError } = await callTool(client, "game_state");
	assert.equal(isError, false);
	const payload = JSON.parse(text) as {
		playerId: string;
		wallet: { gold: number };
	};
	assert.equal(payload.playerId, "p1");
	assert.equal(payload.wallet.gold, 0);
	await client.close();
	db.close();
});

test("game_action starts a gather action and reports it", async () => {
	const { client, db } = await makeHarness();
	const started = await callTool(client, "game_action", {
		command: "start",
		kind: "gather",
		skill: "chopping",
		targetId: "wood",
	});
	assert.equal(started.isError, false);
	const action = JSON.parse(started.text) as { kind: string; targetId: string };
	assert.equal(action.kind, "gather");
	assert.equal(action.targetId, "wood");

	const status = await callTool(client, "game_action", { command: "status" });
	const current = JSON.parse(status.text) as { targetId: string };
	assert.equal(current.targetId, "wood");
	await client.close();
	db.close();
});

test("domain errors come back as text with the error code", async () => {
	const { client, db } = await makeHarness();
	const result = await callTool(client, "game_trade", {
		command: "sell",
		itemId: "wood",
		qty: 1,
	});
	assert.equal(result.isError, true);
	assert.match(result.text, /NotEnoughResources/);
	await client.close();
	db.close();
});

test("read-only key cannot run mutating tools", async () => {
	const { client, db } = await makeHarness(["read"]);
	const result = await callTool(client, "game_action", {
		command: "start",
		kind: "gather",
		skill: "chopping",
		targetId: "wood",
	});
	assert.equal(result.isError, true);
	assert.match(result.text, /scope/);
	await client.close();
	db.close();
});

test("game_upgrades lists prices and buys a level", async () => {
	const { client, db } = await makeHarness();
	const list = await callTool(client, "game_upgrades", { command: "list" });
	const upgrades = JSON.parse(list.text) as {
		id: string;
		nextCost: number | null;
	}[];
	assert.ok(upgrades.length > 0);
	assert.ok(
		upgrades.every(
			(upgrade) => upgrade.nextCost === null || upgrade.nextCost > 0,
		),
	);

	const buy = await callTool(client, "game_upgrades", {
		command: "buy",
		upgradeId: "axe",
	});
	assert.equal(buy.isError, true);
	assert.match(buy.text, /InsufficientFunds/);
	await client.close();
	db.close();
});

test("game_combat forecasts a fight and stores the combat policy", async () => {
	const { client, db } = await makeHarness();
	const forecast = await callTool(client, "game_combat", {
		command: "forecast",
		monsterId: "wolf",
	});
	assert.equal(forecast.isError, false);
	const plan = JSON.parse(forecast.text) as {
		monsterId: string;
		canWin: boolean;
		timeToKillSec: number | null;
		timeToDieSec: number | null;
	};
	assert.equal(plan.monsterId, "wolf");
	assert.equal(plan.canWin, true);
	assert.ok((plan.timeToKillSec ?? 0) > 0);
	assert.ok((plan.timeToDieSec ?? 0) > 0);

	const policy = await callTool(client, "game_combat", {
		command: "policy",
		potionAtHpPercent: 40,
		autoRepeat: true,
	});
	assert.equal(policy.isError, false);
	const stored = JSON.parse(policy.text) as {
		potionAtHpPercent: number | null;
		autoRepeat: boolean;
	};
	assert.equal(stored.potionAtHpPercent, 40);
	assert.equal(stored.autoRepeat, true);

	const state = await callTool(client, "game_state");
	const snapshot = JSON.parse(state.text) as {
		combatPolicy: { potionAtHpPercent: number | null };
		combat: { monsterId: string } | null;
	};
	assert.equal(snapshot.combatPolicy.potionAtHpPercent, 40);
	assert.equal(snapshot.combat, null);

	const started = await callTool(client, "game_combat", {
		command: "fight",
		monsterId: "rabbit",
	});
	assert.equal(started.isError, false);
	const withFight = await callTool(client, "game_state");
	const fighting = JSON.parse(withFight.text) as {
		combat: { monsterId: string; monsterHpLeft: number } | null;
	};
	assert.equal(fighting.combat?.monsterId, "rabbit");
	assert.ok((fighting.combat?.monsterHpLeft ?? 0) > 0);
	await client.close();
	db.close();
});

test("game_log shows recorded events", async () => {
	const { client, db } = await makeHarness();
	await callTool(client, "game_action", {
		command: "start",
		kind: "gather",
		skill: "chopping",
		targetId: "wood",
	});
	const log = await callTool(client, "game_log", { limit: 10 });
	const events = JSON.parse(log.text) as { type: string }[];
	assert.ok(events.some((event) => event.type === "action.started"));
	await client.close();
	db.close();
});

test("resources expose state, skills, market and quests", async () => {
	const { client, db } = await makeHarness();
	const resources = (await client.request("resources/list")) as {
		resources: { uri: string }[];
	};
	const uris = resources.resources.map((resource) => resource.uri).sort();
	assert.deepEqual(uris, [
		"game://market",
		"game://quests",
		"game://skills",
		"game://state",
	]);

	const read = (await client.request("resources/read", {
		uri: "game://state",
	})) as { contents: { text: string }[] };
	const payload = JSON.parse(read.contents[0]?.text ?? "{}") as {
		wallet: unknown;
	};
	assert.ok(payload.wallet);
	await client.close();
	db.close();
});

test("game_strategy prompt is registered and returns text", async () => {
	const { client, db } = await makeHarness();
	const prompts = (await client.request("prompts/list")) as {
		prompts: { name: string }[];
	};
	assert.deepEqual(
		prompts.prompts.map((prompt) => prompt.name),
		["game_strategy"],
	);
	const result = (await client.request("prompts/get", {
		name: "game_strategy",
	})) as { messages: { content: { text: string } }[] };
	assert.match(result.messages[0]?.content.text ?? "", /престиж/i);
	await client.close();
	db.close();
});

test("game_tick advances the game clock", async () => {
	const { client, db } = await makeHarness();
	await callTool(client, "game_action", {
		command: "start",
		kind: "gather",
		skill: "chopping",
		targetId: "wood",
	});
	const ticked = await callTool(client, "game_tick", { seconds: 600 });
	assert.equal(ticked.isError, false);
	const state = await callTool(client, "game_state");
	const payload = JSON.parse(state.text) as {
		inventory: Record<string, number>;
	};
	assert.ok((payload.inventory.wood ?? 0) > 0);
	await client.close();
	db.close();
});
