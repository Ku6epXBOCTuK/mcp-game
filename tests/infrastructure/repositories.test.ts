import { test } from "vitest";
import assert from "node:assert/strict";
import { openMemoryDatabase } from "../../src/infrastructure/persistence/database.ts";
import { SqlitePlayerRepository } from "../../src/infrastructure/persistence/player-repository.ts";
import { SqliteGameRepository } from "../../src/infrastructure/persistence/game-repository.ts";
import { SqliteApiKeyRepository } from "../../src/infrastructure/persistence/api-key-repository.ts";
import { createInitialState } from "../../src/domain/game/state.ts";

test("player repository stores, finds and lists players", async () => {
	const db = openMemoryDatabase();
	const repo = new SqlitePlayerRepository(db);
	const created = await repo.create({
		id: "p1",
		label: "player-1",
		createdAt: 1000,
	});
	assert.equal(created.id, "p1");
	assert.equal(created.label, "player-1");
	assert.equal(created.lastSeenAt, null);
	assert.equal(created.lastReadEventId, null);
	assert.deepEqual(created.meta, {});

	const found = await repo.findById("p1");
	assert.equal(found?.label, "player-1");
	assert.equal(await repo.findById("nope"), null);

	await repo.touchLastSeen("p1", 5000);
	assert.equal((await repo.findById("p1"))?.lastSeenAt, 5000);

	await repo.setLastReadEventId("p1", 7);
	assert.equal((await repo.findById("p1"))?.lastReadEventId, 7);
	await repo.setLastReadEventId("p1", 0);
	assert.equal((await repo.findById("p1"))?.lastReadEventId, 0);

	await repo.create({ id: "p2", label: "player-2", createdAt: 2000 });
	const all = await repo.list();
	assert.deepEqual(
		all.map((player) => player.id),
		["p1", "p2"],
	);
	db.close();
});

test("game repository saves and loads state per player", async () => {
	const db = openMemoryDatabase();
	const players = new SqlitePlayerRepository(db);
	const repo = new SqliteGameRepository(db);
	await players.create({ id: "p1", label: "one", createdAt: 1 });
	await players.create({ id: "p2", label: "two", createdAt: 2 });

	const state = createInitialState("p1", 42, 1000);
	assert.equal(await repo.load("p1"), null);

	await repo.save("p1", state, 1);
	const stored = await repo.load("p1");
	assert.equal(stored?.version, 1);
	assert.equal(stored?.state.playerId, "p1");
	assert.equal(stored?.state.rng.seed, 42);
	assert.equal(await repo.load("p2"), null);

	const next = { ...state, wallet: { gold: 50, credits: 0 } };
	await repo.save("p1", next, 2);
	assert.equal((await repo.load("p1"))?.version, 2);
	assert.equal((await repo.load("p1"))?.state.wallet.gold, 50);
	db.close();
});

test("saving state snapshots the previous version", async () => {
	const db = openMemoryDatabase();
	const players = new SqlitePlayerRepository(db);
	const repo = new SqliteGameRepository(db);
	await players.create({ id: "p1", label: "one", createdAt: 1 });

	const first = createInitialState("p1", 1, 1000);
	await repo.save("p1", first, 1);
	const second = {
		...first,
		wallet: { gold: 10, credits: 0 },
		updatedAt: 2000,
	};
	await repo.save("p1", second, 2);

	const snapshot = await repo.latestSnapshot("p1");
	assert.equal(snapshot?.wallet.gold, 0);
	const snapshots = await repo.listSnapshots("p1", 10);
	assert.equal(snapshots.length, 1);
	db.close();
});

test("events are player scoped and returned newest first", async () => {
	const db = openMemoryDatabase();
	const players = new SqlitePlayerRepository(db);
	const repo = new SqliteGameRepository(db);
	await players.create({ id: "p1", label: "one", createdAt: 1 });
	await players.create({ id: "p2", label: "two", createdAt: 2 });

	await repo.appendEvents("p1", [
		{ ts: 100, type: "craft", payload: { item: "plank" } },
		{ ts: 200, type: "buy", payload: { upgrade: "axe" } },
	]);
	await repo.appendEvents("p2", [
		{ ts: 150, type: "sell", payload: { qty: 3 } },
	]);

	const events = await repo.listEvents("p1", 10);
	assert.equal(events.length, 2);
	assert.equal(events[0]?.type, "buy");
	assert.deepEqual(events[0]?.payload, { upgrade: "axe" });
	assert.equal((await repo.listEvents("p2", 10)).length, 1);
	assert.equal((await repo.listEvents("p2", 10))[0]?.type, "sell");
	db.close();
});

test("events paginate forward from a cursor id", async () => {
	const db = openMemoryDatabase();
	const players = new SqlitePlayerRepository(db);
	const repo = new SqliteGameRepository(db);
	await players.create({ id: "p1", label: "one", createdAt: 1 });

	await repo.appendEvents("p1", [
		{ ts: 100, type: "a", payload: {} },
		{ ts: 200, type: "b", payload: {} },
		{ ts: 300, type: "c", payload: {} },
	]);

	assert.equal(await repo.maxEventId("p1"), 3);
	assert.equal(await repo.maxEventId("nope"), 0);

	const firstPage = await repo.listEventsSince("p1", 0, 2);
	assert.equal(firstPage.truncated, true);
	assert.deepEqual(
		firstPage.events.map((event) => event.type),
		["a", "b"],
	);
	assert.equal(firstPage.lastId, 2);

	const secondPage = await repo.listEventsSince("p1", firstPage.lastId, 2);
	assert.equal(secondPage.truncated, false);
	assert.deepEqual(
		secondPage.events.map((event) => event.type),
		["c"],
	);
	assert.equal(secondPage.lastId, 3);

	const empty = await repo.listEventsSince("p1", secondPage.lastId, 2);
	assert.deepEqual(empty.events, []);
	assert.equal(empty.lastId, secondPage.lastId);
	assert.equal(empty.truncated, false);
	db.close();
});

test("api key repository stores hashed keys and revokes them", async () => {
	const db = openMemoryDatabase();
	const players = new SqlitePlayerRepository(db);
	const repo = new SqliteApiKeyRepository(db);
	await players.create({ id: "p1", label: "one", createdAt: 1 });

	const created = await repo.create({
		id: "k1",
		playerId: "p1",
		keyHash: "hash1",
		keyPrefix: "mcp_live_abcd",
		label: "claude",
		createdAt: 1000,
		scopes: ["read"],
	});
	assert.equal(created.keyPrefix, "mcp_live_abcd");
	assert.deepEqual(created.scopes, ["read"]);
	assert.equal(created.revokedAt, null);

	assert.equal((await repo.findByHash("hash1"))?.id, "k1");
	assert.equal(await repo.findByHash("nope"), null);

	await repo.touchLastUsed("k1", 2000);
	assert.equal((await repo.findByHash("hash1"))?.lastUsedAt, 2000);

	await repo.revoke("k1", 3000);
	assert.equal((await repo.findByHash("hash1"))?.revokedAt, 3000);

	assert.equal((await repo.listByPlayer("p1")).length, 1);
	db.close();
});

test("players are isolated from each other", async () => {
	const db = openMemoryDatabase();
	const players = new SqlitePlayerRepository(db);
	const repo = new SqliteGameRepository(db);
	await players.create({ id: "p1", label: "one", createdAt: 1 });
	await players.create({ id: "p2", label: "two", createdAt: 2 });

	const one = createInitialState("p1", 11, 1000);
	const two = createInitialState("p2", 22, 1000);
	await repo.save("p1", one, 1);
	await repo.save("p2", two, 1);

	assert.equal((await repo.load("p1"))?.state.rng.seed, 11);
	assert.equal((await repo.load("p2"))?.state.rng.seed, 22);
	db.close();
});
