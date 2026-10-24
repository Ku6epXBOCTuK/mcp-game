import type {
	PlayerRepository,
	Player,
} from "../../application/ports/player-repository.ts";
import type { PlayerId } from "../../domain/game/types.ts";
import type { SqliteDatabase } from "./database.ts";

type PlayerRow = {
	id: string;
	label: string;
	created_at: number;
	last_seen_at: number | null;
	last_read_event_id: number | null;
	meta: string;
};

function toPlayer(row: PlayerRow): Player {
	let meta: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(row.meta) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			meta = parsed as Record<string, unknown>;
		}
	} catch {
		meta = {};
	}
	return {
		id: row.id,
		label: row.label,
		createdAt: row.created_at,
		lastSeenAt: row.last_seen_at,
		lastReadEventId: row.last_read_event_id,
		meta,
	};
}

export class SqlitePlayerRepository implements PlayerRepository {
	private readonly db: SqliteDatabase;

	constructor(db: SqliteDatabase) {
		this.db = db;
	}

	async create(input: {
		id: PlayerId;
		label: string;
		createdAt: number;
		meta?: Record<string, unknown>;
	}): Promise<Player> {
		this.db
			.prepare(
				"INSERT INTO players (id, label, created_at, last_seen_at, meta) VALUES (?, ?, ?, NULL, ?)",
			)
			.run(
				input.id,
				input.label,
				input.createdAt,
				JSON.stringify(input.meta ?? {}),
			);
		const player = await this.findById(input.id);
		if (!player) throw new Error(`player ${input.id} not stored`);
		return player;
	}

	async findById(id: PlayerId): Promise<Player | null> {
		const row = this.db
			.prepare("SELECT * FROM players WHERE id = ?")
			.get(id) as PlayerRow | undefined;
		return row ? toPlayer(row) : null;
	}

	async list(): Promise<Player[]> {
		const rows = this.db
			.prepare("SELECT * FROM players ORDER BY created_at ASC")
			.all() as PlayerRow[];
		return rows.map(toPlayer);
	}

	async touchLastSeen(id: PlayerId, at: number): Promise<void> {
		this.db
			.prepare("UPDATE players SET last_seen_at = ? WHERE id = ?")
			.run(at, id);
	}

	async setLastReadEventId(id: PlayerId, value: number): Promise<void> {
		this.db
			.prepare("UPDATE players SET last_read_event_id = ? WHERE id = ?")
			.run(value, id);
	}
}
