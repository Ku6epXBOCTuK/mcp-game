import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AuthMode } from "../infrastructure/http/auth.ts";

export type ServerConfig = {
	dbPath: string;
	contentDir: string;
	publicDir: string;
	host: string;
	port: number;
	dev: boolean;
	auth: AuthMode;
};

function envString(name: string, fallback: string): string {
	const value = process.env[name];
	return value && value.length > 0 ? value : fallback;
}

function authMode(dev: boolean): AuthMode {
	const value = envString("MCPG_AUTH", "").trim().toLowerCase();
	if (value === "off") return "off";
	if (value === "keys") return "keys";
	return dev ? "off" : "keys";
}

export function loadConfig(): ServerConfig {
	const root = resolve(import.meta.dirname, "..", "..");
	const dataDir = resolve(envString("MCPG_DATA_DIR", resolve(root, "data")));
	const dev = envString("MCPG_ENV", "development") !== "production";
	return {
		dbPath: resolve(dataDir, "game.db"),
		contentDir: resolve(
			envString("MCPG_CONTENT_DIR", resolve(root, "content")),
		),
		publicDir: resolve(envString("MCPG_PUBLIC_DIR", resolve(root, "public"))),
		host: envString("MCPG_HOST", "127.0.0.1"),
		port: Number(envString("MCPG_PORT", "3000")),
		dev,
		auth: authMode(dev),
	};
}

export function databaseExists(config: ServerConfig): boolean {
	return existsSync(config.dbPath);
}
