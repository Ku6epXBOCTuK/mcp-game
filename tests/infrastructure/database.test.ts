import { test } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	migrate,
	openDatabase,
	openMemoryDatabase,
} from "../../src/infrastructure/persistence/database.ts";

const TABLES = [
	"players",
	"api_keys",
	"game_states",
	"events",
	"snapshots",
	"schema_migrations",
];

test("memory database gets every table", () => {
	const db = openMemoryDatabase();
	const rows = db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
		.all() as { name: string }[];
	const names = rows.map((row) => row.name);
	for (const table of TABLES) {
		assert.ok(names.includes(table), `missing table ${table}`);
	}
	db.close();
});

test("migration is idempotent", () => {
	const db = openMemoryDatabase();
	migrate(db);
	migrate(db);
	const rows = db
		.prepare("SELECT name FROM schema_migrations ORDER BY name ASC")
		.all() as {
		name: string;
	}[];
	assert.deepEqual(
		rows.map((row) => row.name),
		["001_initial", "002_player_last_read_event"],
	);
	db.close();
});

test("file database persists across reopen", async () => {
	const dir = await mkdtemp(join(tmpdir(), "mcp-db-"));
	const path = join(dir, "game.db");
	const db = openDatabase(path);
	db.prepare(
		"INSERT INTO players (id, label, created_at, meta) VALUES (?, ?, ?, ?)",
	).run("p1", "player-1", 1000, "{}");
	db.close();

	const reopened = openDatabase(path);
	const rows = reopened.prepare("SELECT id, label FROM players").all() as {
		id: string;
		label: string;
	}[];
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.id, "p1");
	assert.equal(rows[0]?.label, "player-1");
	reopened.close();
	await rm(dir, { recursive: true, force: true });
});

test("foreign keys are enforced", () => {
	const db = openMemoryDatabase();
	assert.throws(() => {
		db.prepare(
			"INSERT INTO api_keys (id, player_id, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)",
		).run("k1", "ghost", "hash", "mcp_live_a", 1);
	});
	db.close();
});

test("api key hash is unique", () => {
	const db = openMemoryDatabase();
	db.prepare(
		"INSERT INTO players (id, label, created_at, meta) VALUES (?, ?, ?, ?)",
	).run("p1", "player-1", 1000, "{}");
	const insert = db.prepare(
		"INSERT INTO api_keys (id, player_id, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)",
	);
	insert.run("k1", "p1", "hash1", "mcp_live_a", 1);
	assert.throws(() => insert.run("k2", "p1", "hash1", "mcp_live_b", 2));
	db.close();
});
