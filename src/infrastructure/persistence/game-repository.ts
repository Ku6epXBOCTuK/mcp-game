import type {
	GameRepository,
	StoredGameState,
} from "../../application/ports/game-repository.ts";
import type {
	GameEvent,
	GameState,
	PlayerId,
} from "../../domain/game/types.ts";
import type { SqliteDatabase } from "./database.ts";

type StateRow = {
	player_id: string;
	state: string;
	version: number;
	updated_at: number;
};

type EventRow = {
	ts: number;
	type: string;
	payload: string;
};

type SnapshotRow = {
	ts: number;
	state: string;
};

function parseState(raw: string): GameState {
	return JSON.parse(raw) as GameState;
}

export class SqliteGameRepository implements GameRepository {
	private readonly db: SqliteDatabase;

	constructor(db: SqliteDatabase) {
		this.db = db;
	}

	async load(playerId: PlayerId): Promise<StoredGameState | null> {
		const row = this.db
			.prepare("SELECT * FROM game_states WHERE player_id = ?")
			.get(playerId) as StateRow | undefined;
		if (!row) return null;
		return {
			playerId: row.player_id,
			state: parseState(row.state),
			version: row.version,
			updatedAt: row.updated_at,
		};
	}

	async save(
		playerId: PlayerId,
		state: GameState,
		version: number,
	): Promise<void> {
		this.db.exec("BEGIN");
		try {
			const previous = this.db
				.prepare("SELECT state FROM game_states WHERE player_id = ?")
				.get(playerId) as { state: string } | undefined;
			if (previous) {
				this.db
					.prepare(
						"INSERT INTO snapshots (player_id, ts, state) VALUES (?, ?, ?)",
					)
					.run(playerId, state.updatedAt, previous.state);
			}
			this.db
				.prepare(
					"INSERT INTO game_states (player_id, state, version, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET state = excluded.state, version = excluded.version, updated_at = excluded.updated_at",
				)
				.run(playerId, JSON.stringify(state), version, state.updatedAt);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	async appendEvents(playerId: PlayerId, events: GameEvent[]): Promise<void> {
		if (events.length === 0) return;
		const insert = this.db.prepare(
			"INSERT INTO events (player_id, ts, type, payload) VALUES (?, ?, ?, ?)",
		);
		this.db.exec("BEGIN");
		try {
			for (const event of events) {
				insert.run(
					playerId,
					event.ts,
					event.type,
					JSON.stringify(event.payload),
				);
			}
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	async listEvents(playerId: PlayerId, limit: number): Promise<GameEvent[]> {
		const rows = this.db
			.prepare(
				"SELECT ts, type, payload FROM events WHERE player_id = ? ORDER BY ts DESC, id DESC LIMIT ?",
			)
			.all(playerId, limit) as EventRow[];
		return rows.map((row) => ({
			ts: row.ts,
			type: row.type,
			payload: JSON.parse(row.payload) as Record<string, unknown>,
		}));
	}

	async createSnapshot(
		playerId: PlayerId,
		at: number,
		state: GameState,
	): Promise<void> {
		this.db
			.prepare("INSERT INTO snapshots (player_id, ts, state) VALUES (?, ?, ?)")
			.run(playerId, at, JSON.stringify(state));
	}

	async listSnapshots(
		playerId: PlayerId,
		limit: number,
	): Promise<{ at: number; state: GameState }[]> {
		const rows = this.db
			.prepare(
				"SELECT ts, state FROM snapshots WHERE player_id = ? ORDER BY ts DESC LIMIT ?",
			)
			.all(playerId, limit) as SnapshotRow[];
		return rows.map((row) => ({ at: row.ts, state: parseState(row.state) }));
	}

	async latestSnapshot(playerId: PlayerId): Promise<GameState | null> {
		const row = this.db
			.prepare(
				"SELECT state FROM snapshots WHERE player_id = ? ORDER BY ts DESC LIMIT 1",
			)
			.get(playerId) as { state: string } | undefined;
		return row ? parseState(row.state) : null;
	}
}
