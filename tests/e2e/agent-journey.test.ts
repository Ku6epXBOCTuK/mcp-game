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

type Snapshot = {
	wallet: { gold: number };
	inventory: Record<string, number>;
	skills: Record<string, { level: number; xp: number }>;
	upgrades: Record<string, number>;
	prestige: { points: number; runs: number; layers: number };
	activeAction: { kind: string; targetId: string } | null;
	counters: {
		gathered: Record<string, number>;
		crafted: Record<string, number>;
		killed: Record<string, number>;
	};
	stats: { totalGoldEarned: number };
};

type Client = Awaited<ReturnType<typeof connectTestClient>>;

async function callTool(
	client: Client,
	name: string,
	args: Record<string, unknown> = {},
): Promise<string> {
	const result = (await client.request("tools/call", {
		name,
		arguments: args,
	})) as {
		content?: { type: string; text: string }[];
		isError?: boolean;
	};
	const text = result.content?.[0]?.text ?? "";
	if (result.isError) throw new Error(`${name} failed: ${text}`);
	return text;
}

async function callJson<T>(
	client: Client,
	name: string,
	args: Record<string, unknown> = {},
): Promise<T> {
	return JSON.parse(await callTool(client, name, args)) as T;
}

async function readState(client: Client): Promise<Snapshot> {
	return callJson<Snapshot>(client, "game_state");
}

async function advance(client: Client, seconds: number): Promise<void> {
	await callTool(client, "game_tick", { seconds });
}

async function stopAction(client: Client): Promise<void> {
	const state = await readState(client);
	if (!state.activeAction) return;
	await callTool(client, "game_action", { command: "cancel" });
}

async function startGather(
	client: Client,
	skill: string,
	targetId: string,
): Promise<void> {
	await stopAction(client);
	await callTool(client, "game_action", {
		command: "start",
		kind: "gather",
		skill,
		targetId,
	});
}

async function startCraft(client: Client, recipeId: string): Promise<void> {
	await stopAction(client);
	await callTool(client, "game_action", {
		command: "start",
		kind: "craft",
		recipeId,
	});
}

async function gatherUntil(
	client: Client,
	skill: string,
	targetId: string,
	qty: number,
	maxTicks = 12,
): Promise<void> {
	await startGather(client, skill, targetId);
	for (let i = 0; i < maxTicks; i += 1) {
		const state = await readState(client);
		if ((state.inventory[targetId] ?? 0) >= qty) return;
		await advance(client, 3600);
	}
	const state = await readState(client);
	assert.ok(
		(state.inventory[targetId] ?? 0) >= qty,
		`не набралось ${targetId}: ${state.inventory[targetId] ?? 0}`,
	);
}

async function craftUntil(
	client: Client,
	recipeId: string,
	qty: number,
	maxTicks = 12,
): Promise<void> {
	await startCraft(client, recipeId);
	for (let i = 0; i < maxTicks; i += 1) {
		const state = await readState(client);
		if ((state.counters.crafted[recipeId] ?? 0) >= qty) return;
		await advance(client, 3600);
	}
	const state = await readState(client);
	assert.ok(
		(state.counters.crafted[recipeId] ?? 0) >= qty,
		`не скрафтилось ${recipeId}: ${state.counters.crafted[recipeId] ?? 0}`,
	);
}

async function sellAll(client: Client, itemId: string): Promise<number> {
	const state = await readState(client);
	const qty = state.inventory[itemId] ?? 0;
	if (qty <= 0) return 0;
	await callTool(client, "game_trade", {
		command: "sell",
		itemId,
		qty,
	});
	return qty;
}

test("agent completes the full loop through MCP tools", async () => {
	const db = openMemoryDatabase();
	const clockNow = 1_000_000;
	const service = new GameService({
		games: new SqliteGameRepository(db),
		players: new SqlitePlayerRepository(db),
		content: new FileContentRepository(CONTENT_DIR),
		clock: { now: () => clockNow },
	});
	const factory = createMcpServerFactory({ games: service, dev: true });
	const client = await connectTestClient(
		factory({ playerId: "p1", scopes: ["read", "play"] }),
	);

	await gatherUntil(client, "chopping", "wood", 620, 8);
	await gatherUntil(client, "mining", "stone", 30, 8);
	await stopAction(client);

	const afterGather = await readState(client);
	assert.ok((afterGather.inventory.wood ?? 0) >= 620);
	assert.ok((afterGather.skills.chopping?.level ?? 0) >= 2);
	assert.ok((afterGather.counters.gathered.wood ?? 0) >= 20);
	assert.ok((afterGather.counters.gathered.stone ?? 0) >= 25);

	await craftUntil(client, "chop_log", 150, 6);
	await craftUntil(client, "make_plank", 75, 6);
	await craftUntil(client, "gather_stick", 20, 4);
	await craftUntil(client, "make_hammer", 1, 4);

	const afterCraft = await readState(client);
	assert.ok((afterCraft.counters.crafted.make_hammer ?? 0) >= 1);
	assert.ok((afterCraft.skills.crafting?.level ?? 0) >= 3);

	await sellAll(client, "plank");
	await sellAll(client, "log");
	await sellAll(client, "wood");
	await sellAll(client, "stone");

	const goldBeforeUpgrade = (await readState(client)).wallet.gold;
	const upgrades = await callJson<
		{ id: string; level: number; nextCost: number | null }[]
	>(client, "game_upgrades", { command: "list" });
	const axe = upgrades.find((upgrade) => upgrade.id === "axe");
	assert.ok(axe);
	const axePrice = axe.nextCost ?? 0;
	assert.ok(axePrice > 0);
	await callTool(client, "game_upgrades", {
		command: "buy",
		upgradeId: "axe",
	});
	const afterUpgrade = await readState(client);
	assert.equal(afterUpgrade.upgrades.axe, 1);
	assert.equal(afterUpgrade.wallet.gold, goldBeforeUpgrade - axePrice);

	await stopAction(client);
	await callTool(client, "game_combat", {
		command: "fight",
		monsterId: "rabbit",
	});
	await advance(client, 60);
	const afterFight = await readState(client);
	assert.ok((afterFight.counters.killed.rabbit ?? 0) >= 1);
	await stopAction(client);

	const quests = await callJson<
		{ id: string; status: string; completedSteps: number }[]
	>(client, "game_quests", { command: "list" });
	const stoneAge = quests.find((quest) => quest.id === "quest_stone_age");
	assert.equal(stoneAge?.status, "completed");

	await callTool(client, "game_quests", {
		command: "claim",
		questId: "quest_stone_age",
	});
	const afterQuest = await readState(client);
	assert.ok(afterQuest.wallet.gold > 0);

	for (let i = 0; i < 10; i += 1) {
		const preview = await callJson<{ points: number }>(
			client,
			"game_prestige",
			{ command: "preview" },
		);
		if (preview.points > 0) break;
		await gatherUntil(client, "chopping", "wood", 200, 4);
		await sellAll(client, "wood");
	}
	const preview = await callJson<{ points: number }>(client, "game_prestige", {
		command: "preview",
	});
	assert.ok(preview.points > 0, "престиж должен быть доступен");

	await callTool(client, "game_prestige", { command: "start" });
	const afterPrestige = await readState(client);
	assert.equal(afterPrestige.prestige.runs, 1);
	assert.ok(afterPrestige.prestige.points > 0);
	assert.equal(afterPrestige.wallet.gold, 0);

	const events = await callJson<{ type: string }[]>(client, "game_log", {
		limit: 100,
	});
	const types = events.map((event) => event.type);
	assert.ok(types.includes("action.started"));
	assert.ok(types.includes("upgrade.bought"));
	assert.ok(types.includes("quest.claimed"));
	assert.ok(types.includes("prestige"));

	const skills = await callJson<{ skills: { id: string }[] }>(
		client,
		"game_skills",
	);
	assert.ok(skills.skills.length > 0);

	await client.close();
	db.close();
});
