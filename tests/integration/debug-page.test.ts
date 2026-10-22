import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { openMemoryDatabase } from "../../src/infrastructure/persistence/database.ts";
import { SqlitePlayerRepository } from "../../src/infrastructure/persistence/player-repository.ts";
import { SqliteGameRepository } from "../../src/infrastructure/persistence/game-repository.ts";
import { SqliteApiKeyRepository } from "../../src/infrastructure/persistence/api-key-repository.ts";
import { FileContentRepository } from "../../src/infrastructure/content/loader.ts";
import { ApiKeyService } from "../../src/infrastructure/identity/api-key-service.ts";
import { GameService } from "../../src/application/use-cases/game-service.ts";
import { createMcpRoute } from "../../src/infrastructure/http/mcp-route.ts";
import { createDebugRoute } from "../../src/infrastructure/http/debug-route.ts";
import { createHttpServer } from "../../src/infrastructure/http/server.ts";

const CONTENT_DIR = join(import.meta.dirname, "..", "..", "content");
const PUBLIC_DIR = join(import.meta.dirname, "..", "..", "public");

type Harness = {
	base: string;
	issue: (playerId: string, scopes: string[]) => Promise<string>;
	close: () => Promise<void>;
};

async function startHarness(options: { dev?: boolean } = {}): Promise<Harness> {
	const dev = options.dev ?? true;
	const db = openMemoryDatabase();
	const players = new SqlitePlayerRepository(db);
	const games = new SqliteGameRepository(db);
	const keyService = new ApiKeyService(new SqliteApiKeyRepository(db));
	const gameService = new GameService({
		games,
		players,
		content: new FileContentRepository(CONTENT_DIR),
		clock: { now: () => 1_000_000 },
	});
	const route = createMcpRoute({
		games: gameService,
		keys: keyService,
		dev,
		now: () => 1_000_000,
	});
	const debug = createDebugRoute({
		games: gameService,
		keys: keyService,
		dev,
		now: () => 1_000_000,
	});
	const http = createHttpServer({
		route,
		debug,
		publicDir: PUBLIC_DIR,
		host: "127.0.0.1",
		port: 0,
	});
	await http.listen();
	const address = http.server.address();
	const port = typeof address === "object" && address ? address.port : 0;
	return {
		base: `http://127.0.0.1:${port}`,
		issue: async (playerId, scopes) => {
			await players.create({ id: playerId, label: playerId, createdAt: 1 });
			const issued = await keyService.issue({
				playerId,
				label: "test",
				scopes,
				now: 1,
			});
			return issued.key;
		},
		close: async () => {
			await http.close();
			db.close();
		},
	};
}

async function getState(
	base: string,
	key?: string,
): Promise<{ status: number; body: any }> {
	const response = await fetch(`${base}/api/state`, {
		headers: {
			connection: "close",
			...(key ? { "x-api-key": key } : {}),
		},
	});
	return { status: response.status, body: await response.json() };
}

async function postAction(
	base: string,
	key: string,
	payload: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
	const response = await fetch(`${base}/api/action`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			connection: "close",
			"x-api-key": key,
		},
		body: JSON.stringify(payload),
	});
	return { status: response.status, body: await response.json() };
}

test("index page is served as html", async () => {
	const harness = await startHarness();
	const response = await fetch(`${harness.base}/`, {
		headers: { connection: "close" },
	});
	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type") ?? "", /text\/html/);
	const html = await response.text();
	assert.match(html, /debug\.js/);
	assert.match(html, /id="feed"/);
	await harness.close();
});

test("debug script is served", async () => {
	const harness = await startHarness();
	const response = await fetch(`${harness.base}/debug.js`, {
		headers: { connection: "close" },
	});
	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type") ?? "", /javascript/);
	const script = await response.text();
	assert.match(script, /\/api\/state/);
	assert.match(script, /\/api\/action/);
	await harness.close();
});

test("state endpoint returns the player snapshot", async () => {
	const harness = await startHarness();
	const key = await harness.issue("p1", ["read", "play"]);
	const response = await getState(harness.base, key);
	assert.equal(response.status, 200);
	assert.equal(response.body.player.id, "p1");
	assert.equal(response.body.canPlay, true);
	assert.equal(response.body.dev, true);
	assert.ok(Array.isArray(response.body.skills));
	assert.equal(response.body.skills.length, 8);
	assert.equal(response.body.upgrades.length, 12);
	assert.ok(Array.isArray(response.body.events));
	await harness.close();
});

test("state endpoint falls back to the first player in dev mode", async () => {
	const harness = await startHarness();
	await harness.issue("p1", ["read"]);
	const response = await getState(harness.base);
	assert.equal(response.status, 200);
	assert.equal(response.body.player.id, "p1");
	await harness.close();
});

test("state endpoint rejects an unknown key", async () => {
	const harness = await startHarness();
	const response = await getState(harness.base, `mcp_live_${"z".repeat(32)}`);
	assert.equal(response.status, 403);
	await harness.close();
});

test("read-only key cannot run actions", async () => {
	const harness = await startHarness();
	const key = await harness.issue("p1", ["read"]);
	const response = await postAction(harness.base, key, {
		command: "cancel",
	});
	assert.equal(response.status, 403);
	assert.match(response.body.error, /play/);
	await harness.close();
});

test("action endpoint starts and cancels an action", async () => {
	const harness = await startHarness();
	const key = await harness.issue("p1", ["read", "play"]);
	const started = await postAction(harness.base, key, {
		command: "start",
		kind: "gather",
		skill: "chopping",
		targetId: "wood",
	});
	assert.equal(started.status, 200);
	assert.equal(started.body.ok, true);

	const state = await getState(harness.base, key);
	assert.ok(state.body.activeAction);
	assert.equal(state.body.activeAction.kind, "gather");

	const cancelled = await postAction(harness.base, key, { command: "cancel" });
	assert.equal(cancelled.status, 200);
	const after = await getState(harness.base, key);
	assert.equal(after.body.activeAction, null);
	await harness.close();
});

test("action endpoint reports domain errors", async () => {
	const harness = await startHarness();
	const key = await harness.issue("p1", ["read", "play"]);
	const response = await postAction(harness.base, key, {
		command: "buy_upgrade",
		upgradeId: "unknown_upgrade",
	});
	assert.equal(response.status, 400);
	assert.match(response.body.error, /NotEnough|Unknown|Upgrade/i);
	await harness.close();
});

test("action endpoint rejects unknown commands", async () => {
	const harness = await startHarness();
	const key = await harness.issue("p1", ["read", "play"]);
	const response = await postAction(harness.base, key, { command: "nope" });
	assert.equal(response.status, 400);
	await harness.close();
});

test("two players see different snapshots", async () => {
	const harness = await startHarness();
	const keyOne = await harness.issue("p1", ["read", "play"]);
	const keyTwo = await harness.issue("p2", ["read", "play"]);
	const one = await getState(harness.base, keyOne);
	const two = await getState(harness.base, keyTwo);
	assert.equal(one.body.player.id, "p1");
	assert.equal(two.body.player.id, "p2");
	await harness.close();
});
