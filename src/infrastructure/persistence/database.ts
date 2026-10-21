import { DatabaseSync } from "node:sqlite";

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "001_initial",
    sql: `
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        meta TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        player_id TEXT NOT NULL REFERENCES players(id),
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        label TEXT,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        revoked_at INTEGER,
        scopes TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_api_keys_player ON api_keys(player_id);

      CREATE TABLE IF NOT EXISTS game_states (
        player_id TEXT PRIMARY KEY REFERENCES players(id),
        state TEXT NOT NULL,
        version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL REFERENCES players(id),
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_events_player_ts ON events(player_id, ts);

      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        player_id TEXT NOT NULL REFERENCES players(id),
        ts INTEGER NOT NULL,
        state TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_player_ts ON snapshots(player_id, ts);

      CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `,
  },
];

export function openDatabase(path: string): SqliteDatabase {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

export function openMemoryDatabase(): SqliteDatabase {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: SqliteDatabase, now: number = Date.now()): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
  );
  const applied = new Set(
    (
      db
        .prepare("SELECT name FROM schema_migrations")
        .all() as { name: string }[]
    ).map((row) => row.name),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
        migration.name,
        now,
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
