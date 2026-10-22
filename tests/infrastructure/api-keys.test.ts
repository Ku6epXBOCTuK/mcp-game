import { test } from "vitest";
import assert from "node:assert/strict";
import { openMemoryDatabase } from "../../src/infrastructure/persistence/database.ts";
import { SqlitePlayerRepository } from "../../src/infrastructure/persistence/player-repository.ts";
import { SqliteApiKeyRepository } from "../../src/infrastructure/persistence/api-key-repository.ts";
import { ApiKeyService } from "../../src/infrastructure/identity/api-key-service.ts";
import {
	generateApiKey,
	hashApiKey,
	isApiKeyFormat,
	keyPrefix,
} from "../../src/infrastructure/identity/api-keys.ts";

async function makeService(): Promise<{
	service: ApiKeyService;
	players: SqlitePlayerRepository;
	db: ReturnType<typeof openMemoryDatabase>;
}> {
	const db = openMemoryDatabase();
	const players = new SqlitePlayerRepository(db);
	await players.create({ id: "p1", label: "one", createdAt: 1 });
	return {
		service: new ApiKeyService(new SqliteApiKeyRepository(db)),
		players,
		db,
	};
}

test("generated key has the documented format", () => {
	const generated = generateApiKey();
	assert.match(generated.key, /^mcp_live_[0-9A-Za-z]{32}$/);
	assert.equal(generated.prefix, `mcp_live_${generated.key.slice(9, 13)}`);
	assert.equal(keyPrefix(generated.key), generated.prefix);
	assert.equal(isApiKeyFormat(generated.key), true);
});

test("generated keys are unique and hash differently", () => {
	const a = generateApiKey();
	const b = generateApiKey();
	assert.notEqual(a.key, b.key);
	assert.notEqual(a.hash, b.hash);
	assert.equal(hashApiKey(a.key), a.hash);
	assert.equal(a.hash.length, 64);
});

test("malformed keys are rejected by format check", () => {
	assert.equal(isApiKeyFormat("nope"), false);
	assert.equal(isApiKeyFormat("mcp_live_short"), false);
	assert.equal(isApiKeyFormat(`mcp_live_${"!".repeat(32)}`), false);
	assert.equal(isApiKeyFormat(`mcp_live_${"a".repeat(31)}`), false);
});

test("issued key resolves to its player", async () => {
	const { service, db } = await makeService();
	const issued = await service.issue({
		playerId: "p1",
		label: "claude",
		scopes: ["read", "play"],
		now: 1000,
	});
	assert.equal(issued.playerId, "p1");
	assert.equal(issued.scopes.length, 2);

	const resolved = await service.resolve(issued.key, 2000);
	assert.equal(resolved?.playerId, "p1");
	assert.deepEqual(resolved?.scopes, ["read", "play"]);
	db.close();
});

test("unknown and revoked keys do not resolve", async () => {
	const { service, db } = await makeService();
	const issued = await service.issue({
		playerId: "p1",
		label: null,
		scopes: ["play"],
		now: 1000,
	});
	assert.equal(await service.resolve("mcp_live_" + "z".repeat(32), 2000), null);
	assert.equal(await service.resolve("garbage", 2000), null);

	const revoked = await service.revoke(issued.id, 3000);
	assert.equal(revoked, true);
	assert.equal(await service.resolve(issued.key, 4000), null);
	assert.equal(await service.revoke(issued.id, 5000), false);
	db.close();
});

test("resolve updates last used timestamp", async () => {
	const { service, db } = await makeService();
	const issued = await service.issue({
		playerId: "p1",
		label: null,
		scopes: ["play"],
		now: 1000,
	});
	await service.resolve(issued.key, 7777);
	const record = (await service.list("p1"))[0];
	assert.equal(record?.lastUsedAt, 7777);
	db.close();
});

test("the raw key is never stored in the database", async () => {
	const db = openMemoryDatabase();
	const players = new SqlitePlayerRepository(db);
	await players.create({ id: "p1", label: "one", createdAt: 1 });
	const service = new ApiKeyService(new SqliteApiKeyRepository(db));
	const issued = await service.issue({
		playerId: "p1",
		label: null,
		scopes: ["play"],
		now: 1000,
	});
	const rows = db
		.prepare("SELECT key_hash, key_prefix FROM api_keys")
		.all() as {
		key_hash: string;
		key_prefix: string;
	}[];
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.key_hash, hashApiKey(issued.key));
	assert.notEqual(rows[0]?.key_hash, issued.key);
	assert.ok(issued.key.startsWith(rows[0]?.key_prefix ?? "x"));
	db.close();
});
