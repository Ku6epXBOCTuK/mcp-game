import { randomUUID } from "node:crypto";
import type {
  ApiKeyRecord,
  ApiKeyRepository,
} from "../../application/ports/api-key-repository.ts";
import type { PlayerId } from "../../domain/game/types.ts";
import { generateApiKey, hashApiKey, isApiKeyFormat } from "./api-keys.ts";

export type IssuedApiKey = {
  id: string;
  key: string;
  prefix: string;
  playerId: PlayerId;
  scopes: string[];
};

export type ResolvedApiKey = {
  keyId: string;
  playerId: PlayerId;
  scopes: string[];
};

export class ApiKeyService {
  private readonly keys: ApiKeyRepository;

  constructor(keys: ApiKeyRepository) {
    this.keys = keys;
  }

  async issue(input: {
    playerId: PlayerId;
    label: string | null;
    scopes: string[];
    now: number;
  }): Promise<IssuedApiKey> {
    const generated = generateApiKey();
    const id = randomUUID();
    await this.keys.create({
      id,
      playerId: input.playerId,
      keyHash: generated.hash,
      keyPrefix: generated.prefix,
      label: input.label,
      createdAt: input.now,
      scopes: input.scopes,
    });
    return {
      id,
      key: generated.key,
      prefix: generated.prefix,
      playerId: input.playerId,
      scopes: input.scopes,
    };
  }

  async resolve(rawKey: string, now: number): Promise<ResolvedApiKey | null> {
    if (!isApiKeyFormat(rawKey)) return null;
    const record = await this.keys.findByHash(hashApiKey(rawKey));
    if (!record) return null;
    if (record.revokedAt !== null) return null;
    await this.keys.touchLastUsed(record.id, now);
    return { keyId: record.id, playerId: record.playerId, scopes: record.scopes };
  }

  async list(playerId: PlayerId): Promise<ApiKeyRecord[]> {
    return this.keys.listByPlayer(playerId);
  }

  async revoke(id: string, now: number): Promise<boolean> {
    const record = await this.keys.findById(id);
    if (!record) return false;
    if (record.revokedAt !== null) return false;
    await this.keys.revoke(id, now);
    return true;
  }
}
