import type {
  ApiKeyRecord,
  ApiKeyRepository,
} from "../../application/ports/api-key-repository.ts";
import type { SqliteDatabase } from "./database.ts";

type ApiKeyRow = {
  id: string;
  player_id: string;
  key_prefix: string;
  label: string | null;
  created_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  scopes: string;
};

function toRecord(row: ApiKeyRow): ApiKeyRecord {
  let scopes: string[] = [];
  try {
    const parsed = JSON.parse(row.scopes) as unknown;
    if (Array.isArray(parsed)) {
      scopes = parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    scopes = [];
  }
  return {
    id: row.id,
    playerId: row.player_id,
    keyPrefix: row.key_prefix,
    label: row.label,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    scopes,
  };
}

export class SqliteApiKeyRepository implements ApiKeyRepository {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  async create(input: {
    id: string;
    playerId: string;
    keyHash: string;
    keyPrefix: string;
    label: string | null;
    createdAt: number;
    scopes: string[];
  }): Promise<ApiKeyRecord> {
    this.db
      .prepare(
        "INSERT INTO api_keys (id, player_id, key_hash, key_prefix, label, created_at, last_used_at, revoked_at, scopes) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)",
      )
      .run(
        input.id,
        input.playerId,
        input.keyHash,
        input.keyPrefix,
        input.label,
        input.createdAt,
        JSON.stringify(input.scopes),
      );
    const record = await this.findByHash(input.keyHash);
    if (!record) throw new Error(`api key ${input.id} not stored`);
    return record;
  }

  async findByHash(keyHash: string): Promise<ApiKeyRecord | null> {
    const row = this.db
      .prepare("SELECT * FROM api_keys WHERE key_hash = ?")
      .get(keyHash) as ApiKeyRow | undefined;
    return row ? toRecord(row) : null;
  }

  async listByPlayer(playerId: string): Promise<ApiKeyRecord[]> {
    const rows = this.db
      .prepare("SELECT * FROM api_keys WHERE player_id = ? ORDER BY created_at ASC")
      .all(playerId) as ApiKeyRow[];
    return rows.map(toRecord);
  }

  async revoke(id: string, at: number): Promise<void> {
    this.db
      .prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
      .run(at, id);
  }

  async touchLastUsed(id: string, at: number): Promise<void> {
    this.db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(at, id);
  }
}
