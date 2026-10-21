import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type ServerConfig = {
  dbPath: string;
  contentDir: string;
  host: string;
  port: number;
  dev: boolean;
};

function envString(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export function loadConfig(): ServerConfig {
  const root = resolve(import.meta.dirname, "..", "..");
  const dataDir = resolve(envString("MCPG_DATA_DIR", resolve(root, "data")));
  return {
    dbPath: resolve(dataDir, "game.db"),
    contentDir: resolve(envString("MCPG_CONTENT_DIR", resolve(root, "content"))),
    host: envString("MCPG_HOST", "127.0.0.1"),
    port: Number(envString("MCPG_PORT", "3000")),
    dev: envString("MCPG_ENV", "development") !== "production",
  };
}

export function databaseExists(config: ServerConfig): boolean {
  return existsSync(config.dbPath);
}
