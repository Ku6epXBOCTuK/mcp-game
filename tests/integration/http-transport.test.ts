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
	keys: ApiKeyService;
	issue: (playerId: string, scopes: string[]) => Promise<string>;
	close: () => Promise<void>;
};

async function startHarness(
	options: { auth?: "off" | "keys" } = {},
): Promise<Harness> {
	const auth = options.auth ?? "keys";
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
		auth,
		dev: true,
		now: () => 1_000_000,
	});
	const debug = createDebugRoute({
		games: gameService,
		keys: keyService,
		auth,
		dev: true,
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
		keys: keyService,
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

function parseRpcBody(text: string): any {
	const trimmed = text.trim();
	if (trimmed.startsWith("event:") || trimmed.startsWith("data:")) {
		const dataLines = trimmed
			.split(/\r?\n/)
			.filter((line) => line.startsWith("data:"))
			.map((line) => line.slice(5).trim());
		const payload = dataLines.join("");
		try {
			return JSON.parse(payload);
		} catch {
			return payload;
		}
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		return trimmed;
	}
}

async function rpc(
	base: string,
	method: string,
	params: unknown,
	headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
	const response = await fetch(`${base}/mcp`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			connection: "close",
			...headers,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
	const text = await response.text();
	return { status: response.status, body: parseRpcBody(text) };
}

test("request without an api key is rejected with 401", async () => {
	const harness = await startHarness();
	const response = await rpc(harness.base, "tools/list", {});
	assert.equal(response.status, 401);
	await harness.close();
});

test("request with an unknown api key is rejected with 403", async () => {
	const harness = await startHarness();
	const response = await rpc(
		harness.base,
		"tools/list",
		{},
		{ authorization: `Bearer mcp_live_${"z".repeat(32)}` },
	);
	assert.equal(response.status, 403);
	await harness.close();
});

test("request without an api key works when auth is off", async () => {
	const harness = await startHarness({ auth: "off" });
	await harness.issue("p1", ["read", "play"]);
	const response = await rpc(harness.base, "tools/list", {});
	assert.equal(response.status, 200);
	assert.equal((response.body?.result?.tools ?? []).length, 13);
	await harness.close();
});

test("auth off ignores an unknown api key", async () => {
	const harness = await startHarness({ auth: "off" });
	await harness.issue("p1", ["read", "play"]);
	const response = await rpc(
		harness.base,
		"tools/list",
		{},
		{ authorization: `Bearer mcp_live_${"z".repeat(32)}` },
	);
	assert.equal(response.status, 200);
	await harness.close();
});

test("request with a valid api key lists the 13 tools", async () => {
	const harness = await startHarness();
	const key = await harness.issue("p1", ["read", "play"]);
	const response = await rpc(
		harness.base,
		"tools/list",
		{},
		{
			authorization: `Bearer ${key}`,
		},
	);
	assert.equal(response.status, 200);
	const tools = response.body?.result?.tools ?? [];
	assert.equal(tools.length, 13);
	await harness.close();
});

test("api key can be passed in the x-api-key header", async () => {
	const harness = await startHarness();
	const key = await harness.issue("p1", ["read", "play"]);
	const response = await rpc(
		harness.base,
		"tools/list",
		{},
		{
			"x-api-key": key,
		},
	);
	assert.equal(response.status, 200);
	assert.equal((response.body?.result?.tools ?? []).length, 13);
	await harness.close();
});

test("api key can be passed as a query parameter in dev mode", async () => {
	const harness = await startHarness();
	const key = await harness.issue("p1", ["read", "play"]);
	const response = await fetch(`${harness.base}/mcp?key=${key}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			connection: "close",
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/list",
			params: {},
		}),
	});
	assert.equal(response.status, 200);
	await harness.close();
});

test("a tool call reaches the game state of its player", async () => {
	const harness = await startHarness();
	const key = await harness.issue("p1", ["read", "play"]);
	const response = await rpc(
		harness.base,
		"tools/call",
		{ name: "game_state", arguments: {} },
		{ authorization: `Bearer ${key}` },
	);
	assert.equal(response.status, 200);
	const text = response.body?.result?.content?.[0]?.text ?? "";
	assert.match(text, /p1|playerId|wallet/);
	await harness.close();
});

test("two players get different states", async () => {
	const harness = await startHarness();
	const keyOne = await harness.issue("p1", ["read", "play"]);
	const keyTwo = await harness.issue("p2", ["read", "play"]);
	const one = await rpc(
		harness.base,
		"tools/call",
		{ name: "game_state", arguments: {} },
		{ authorization: `Bearer ${keyOne}` },
	);
	const two = await rpc(
		harness.base,
		"tools/call",
		{ name: "game_state", arguments: {} },
		{ authorization: `Bearer ${keyTwo}` },
	);
	assert.equal(
		one.body?.result?.content?.[0]?.text !==
			two.body?.result?.content?.[0]?.text,
		true,
	);
	await harness.close();
});

test("read-only key cannot mutate the game", async () => {
	const harness = await startHarness();
	const key = await harness.issue("p1", ["read"]);
	const response = await rpc(
		harness.base,
		"tools/call",
		{
			name: "game_action",
			arguments: { command: "start", skill: "chopping", item: "wood" },
		},
		{ authorization: `Bearer ${key}` },
	);
	assert.equal(response.status, 200);
	const text = response.body?.result?.content?.[0]?.text ?? "";
	assert.match(text, /scope|read|play/i);
	await harness.close();
});

test("unknown route returns 404", async () => {
	const harness = await startHarness();
	const response = await fetch(`${harness.base}/nope`);
	assert.equal(response.status, 404);
	await harness.close();
});
