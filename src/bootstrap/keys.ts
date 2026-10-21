import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openDatabase } from "../infrastructure/persistence/database.ts";
import { SqlitePlayerRepository } from "../infrastructure/persistence/player-repository.ts";
import { SqliteApiKeyRepository } from "../infrastructure/persistence/api-key-repository.ts";
import { ApiKeyService } from "../infrastructure/identity/api-key-service.ts";
import { loadConfig } from "./config.ts";

type Command = "create" | "list" | "revoke";

function parseArgs(argv: string[]): {
  command: Command;
  label: string | null;
  keyId: string | null;
  scopes: string[];
} {
  const [command = "list", ...rest] = argv;
  let label: string | null = null;
  let keyId: string | null = null;
  const scopes: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--label") {
      label = rest[i + 1] ?? null;
      i += 1;
    } else if (arg === "--id") {
      keyId = rest[i + 1] ?? null;
      i += 1;
    } else if (arg === "--scopes") {
      scopes.push(...(rest[i + 1] ?? "").split(",").filter((s) => s.length > 0));
      i += 1;
    }
  }
  return { command: command as Command, label, keyId, scopes };
}

async function main(): Promise<void> {
  const config = loadConfig();
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = openDatabase(config.dbPath);
  const players = new SqlitePlayerRepository(db);
  const keys = new SqliteApiKeyRepository(db);
  const service = new ApiKeyService(keys);
  const args = parseArgs(process.argv.slice(2));
  const now = Date.now();

  if (args.command === "create") {
    const existing = await players.list();
    const player =
      existing[0] ??
      (await players.create({ id: crypto.randomUUID(), label: "player-1", createdAt: now }));
    const issued = await service.issue({
      playerId: player.id,
      label: args.label,
      scopes: args.scopes.length > 0 ? args.scopes : ["read", "play"],
      now,
    });
    console.log(issued.key);
    console.log(`player: ${player.id}`);
    console.log(`key id: ${issued.id}`);
    console.log(`prefix: ${issued.prefix}`);
    return;
  }

  if (args.command === "list") {
    for (const player of await players.list()) {
      console.log(`player ${player.id} (${player.label})`);
      for (const key of await service.list(player.id)) {
        console.log(
          `  ${key.id} ${key.keyPrefix} label=${key.label ?? "-"} scopes=${key.scopes.join(",")} revoked=${key.revokedAt !== null}`,
        );
      }
    }
    return;
  }

  if (args.command === "revoke") {
    if (!args.keyId) {
      console.error("revoke requires --id <key id>");
      process.exitCode = 1;
      return;
    }
    const ok = await service.revoke(args.keyId, now);
    console.log(ok ? `revoked ${args.keyId}` : `key ${args.keyId} not found`);
    if (!ok) process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
