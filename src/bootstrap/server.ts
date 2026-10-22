import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { systemClock } from "../application/ports/clock.ts";
import { GameService } from "../application/use-cases/game-service.ts";
import { openDatabase } from "../infrastructure/persistence/database.ts";
import { SqlitePlayerRepository } from "../infrastructure/persistence/player-repository.ts";
import { SqliteGameRepository } from "../infrastructure/persistence/game-repository.ts";
import { SqliteApiKeyRepository } from "../infrastructure/persistence/api-key-repository.ts";
import { FileContentRepository } from "../infrastructure/content/loader.ts";
import { ApiKeyService } from "../infrastructure/identity/api-key-service.ts";
import { createMcpRoute } from "../infrastructure/http/mcp-route.ts";
import { createDebugRoute } from "../infrastructure/http/debug-route.ts";
import { createHttpServer } from "../infrastructure/http/server.ts";
import { loadConfig } from "./config.ts";

export type RunningServer = {
	port: number;
	host: string;
	close: () => Promise<void>;
};

export async function startServer(): Promise<RunningServer> {
	const config = loadConfig();
	mkdirSync(dirname(config.dbPath), { recursive: true });

	const db = openDatabase(config.dbPath);
	const players = new SqlitePlayerRepository(db);
	const games = new SqliteGameRepository(db);
	const keysRepo = new SqliteApiKeyRepository(db);
	const content = new FileContentRepository(config.contentDir);
	const clock = systemClock();

	const gamesService = new GameService({
		games,
		players,
		content,
		clock,
	});
	const keyService = new ApiKeyService(keysRepo);

	const contentResult = await gamesService.loadContent();
	if (contentResult.isErr()) {
		console.error(`Контент невалиден: ${contentResult.error.message}`);
		process.exit(1);
	}

	const route = createMcpRoute({
		games: gamesService,
		keys: keyService,
		auth: config.auth,
		dev: config.dev,
		now: () => clock.now(),
	});
	const debugRoute = createDebugRoute({
		games: gamesService,
		keys: keyService,
		auth: config.auth,
		dev: config.dev,
		now: () => clock.now(),
	});
	const http = createHttpServer({
		route,
		debug: debugRoute,
		publicDir: config.publicDir,
		host: config.host,
		port: config.port,
	});
	await http.listen();

	const existing = await players.list();
	const player =
		existing[0] ??
		(await players.create({
			id: crypto.randomUUID(),
			label: "player-1",
			createdAt: clock.now(),
		}));
	const playerKeys = await keyService.list(player.id);
	if (config.auth === "keys" && playerKeys.length === 0) {
		const issued = await keyService.issue({
			playerId: player.id,
			label: "default",
			scopes: ["read", "play"],
			now: clock.now(),
		});
		console.log(`API-ключ (показывается один раз): ${issued.key}`);
	}

	console.log(`MCP: http://${config.host}:${config.port}/mcp`);
	console.log(`Дебаг: http://${config.host}:${config.port}/`);
	console.log(`Игрок: ${player.id}`);
	console.log(
		config.auth === "off"
			? "Авторизация: отключена (MCPG_AUTH=off), ключ не нужен"
			: "Авторизация: по API-ключу (MCPG_AUTH=keys)",
	);

	return {
		port: config.port,
		host: config.host,
		close: async () => {
			await http.close();
			db.close();
		},
	};
}

const isEntrypoint =
	process.argv[1] && import.meta.filename === process.argv[1];
if (isEntrypoint) {
	startServer().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
