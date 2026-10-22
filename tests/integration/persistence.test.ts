import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../../src/infrastructure/persistence/database.ts";
import { SqlitePlayerRepository } from "../../src/infrastructure/persistence/player-repository.ts";
import { SqliteGameRepository } from "../../src/infrastructure/persistence/game-repository.ts";
import { FileContentRepository } from "../../src/infrastructure/content/loader.ts";
import { GameService } from "../../src/application/use-cases/game-service.ts";

const CONTENT_DIR = join(import.meta.dirname, "..", "..", "content");

async function withFileDb<T>(
  run: (ctx: {
    dir: string;
    path: string;
    service: GameService;
    db: ReturnType<typeof openDatabase>;
  }) => Promise<T>,
  now = 1_000_000,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "mcp-persist-"));
  const path = join(dir, "game.db");
  const db = openDatabase(path);
  const service = new GameService({
    games: new SqliteGameRepository(db),
    players: new SqlitePlayerRepository(db),
    content: new FileContentRepository(CONTENT_DIR),
    clock: { now: () => now },
  });
  try {
    return await run({ dir, path, service, db });
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("state survives a server restart with the same database file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-persist-"));
  const path = join(dir, "game.db");
  try {
    const firstDb = openDatabase(path);
    const first = new GameService({
      games: new SqliteGameRepository(firstDb),
      players: new SqlitePlayerRepository(firstDb),
      content: new FileContentRepository(CONTENT_DIR),
      clock: { now: () => 1_000_000 },
    });
    await first.gather("p1", "chopping", "wood");
    firstDb.close();

    const secondDb = openDatabase(path);
    const second = new GameService({
      games: new SqliteGameRepository(secondDb),
      players: new SqlitePlayerRepository(secondDb),
      content: new FileContentRepository(CONTENT_DIR),
      clock: { now: () => 1_000_000 },
    });
    const state = await second.getState("p1");
    assert.equal(state.isOk(), true);
    if (state.isOk()) {
      assert.equal(state.value.state.activeAction?.kind, "gather");
      assert.equal(state.value.state.playerId, "p1");
    }
    secondDb.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("state version grows on every persisted change", async () => {
  await withFileDb(async ({ service, db }) => {
    const first = await service.getState("p1");
    assert.equal(first.isOk(), true);
    const firstVersion = first.isOk() ? first.value.version : -1;

    await service.gather("p1", "chopping", "wood");
    const second = await service.getState("p1");
    const secondVersion = second.isOk() ? second.value.version : -1;
    assert.ok(secondVersion > firstVersion, "version must grow");

    const rows = db.prepare("SELECT version FROM game_states WHERE player_id = ?").all("p1") as {
      version: number;
    }[];
    assert.equal(rows[0]?.version, secondVersion);
  });
});

test("every persisted state change keeps a snapshot of the previous version", async () => {
  await withFileDb(async ({ service, db }) => {
    await service.getState("p1");
    await service.gather("p1", "chopping", "wood");
    const snapshots = db
      .prepare("SELECT COUNT(*) AS n FROM snapshots WHERE player_id = ?")
      .get("p1") as { n: number };
    assert.ok(snapshots.n >= 1, "a snapshot must exist after an update");
  });
});

test("offline progress is applied when the player returns", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcp-persist-"));
  const path = join(dir, "game.db");
  try {
    const db = openDatabase(path);
    const service = new GameService({
      games: new SqliteGameRepository(db),
      players: new SqlitePlayerRepository(db),
      content: new FileContentRepository(CONTENT_DIR),
      clock: { now: () => 1_000_000 },
    });
    await service.gather("p1", "chopping", "wood");
    db.close();

    const later = 1_000_000 + 60_000;
    const secondDb = openDatabase(path);
    const second = new GameService({
      games: new SqliteGameRepository(secondDb),
      players: new SqlitePlayerRepository(secondDb),
      content: new FileContentRepository(CONTENT_DIR),
      clock: { now: () => later },
    });
    const state = await second.getState("p1");
    assert.equal(state.isOk(), true);
    if (state.isOk()) {
      assert.ok((state.value.state.inventory.wood ?? 0) > 0, "offline gather applied");
      assert.equal(state.value.state.lastTickAt, later);
    }
    secondDb.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two players keep separate states, events and snapshots in one database", async () => {
  await withFileDb(async ({ service, db }) => {
    await service.gather("p1", "chopping", "wood");
    await service.advanceTime("p2", 60);

    const one = await service.getState("p1");
    const two = await service.getState("p2");
    assert.equal(one.isOk(), true);
    assert.equal(two.isOk(), true);
    if (one.isOk() && two.isOk()) {
      assert.equal(one.value.state.activeAction?.kind, "gather");
      assert.equal(two.value.state.activeAction, null);
      assert.notEqual(
        one.value.state.rng.seed,
        two.value.state.rng.seed,
        "each player gets its own seed",
      );
    }

    const oneEvents = await service.listEvents("p1", 50);
    const twoEvents = await service.listEvents("p2", 50);
    assert.ok(oneEvents.some((event) => event.type === "action.started"));
    assert.ok(!oneEvents.some((event) => event.type === "time.advanced"));
    assert.ok(twoEvents.some((event) => event.type === "time.advanced"));
    assert.ok(!twoEvents.some((event) => event.type === "action.started"));

    const perPlayer = db
      .prepare("SELECT player_id, COUNT(*) AS n FROM events GROUP BY player_id")
      .all() as { player_id: string; n: number }[];
    assert.equal(perPlayer.length, 2);
  });
});

test("the event feed keeps a bounded window", async () => {
  await withFileDb(async ({ service, db }) => {
    for (let i = 0; i < 5; i += 1) {
      await service.advanceTime("p1", 1);
    }
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM events WHERE player_id = ?")
      .get("p1") as { n: number };
    assert.ok(rows.n >= 5);
    const limited = await service.listEvents("p1", 2);
    assert.equal(limited.length, 2);
  });
});
