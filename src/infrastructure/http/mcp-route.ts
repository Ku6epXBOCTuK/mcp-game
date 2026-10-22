import { createMcpHandler } from "@modelcontextprotocol/server";
import type { GameService } from "../../application/use-cases/game-service.ts";
import type { ApiKeyService } from "../identity/api-key-service.ts";
import { createMcpServerFactory } from "../mcp/server.ts";
import type { McpScope } from "../mcp/tool-result.ts";
import { extractApiKey, resolveApiKey } from "./auth.ts";

export type McpRouteDeps = {
	games: GameService;
	keys: ApiKeyService;
	dev: boolean;
	now: () => number;
};

export type McpRoute = {
	handle: (request: Request) => Promise<Response>;
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

export function createMcpRoute(deps: McpRouteDeps): McpRoute {
	const serverFactory = createMcpServerFactory({
		games: deps.games,
		dev: deps.dev,
	});

	const handler = createMcpHandler((ctx) => {
		const playerId = ctx.authInfo?.clientId ?? "";
		const scopes = (ctx.authInfo?.scopes ?? []) as McpScope[];
		return serverFactory({ playerId, scopes });
	});

	return {
		async handle(request: Request): Promise<Response> {
			const resolution = await resolveApiKey(request, deps.keys, {
				dev: deps.dev,
				now: deps.now(),
			});
			if (!resolution.ok) {
				const status = resolution.reason === "missing" ? 401 : 403;
				const message =
					resolution.reason === "missing"
						? "Отсутствует API-ключ. Передайте Authorization: Bearer <key>."
						: "API-ключ не найден или отозван.";
				return jsonResponse(status, { error: message });
			}
			const rawKey = extractApiKey(request, deps.dev) ?? "";
			return handler.fetch(request, {
				authInfo: {
					token: rawKey,
					clientId: resolution.playerId,
					scopes: resolution.scopes,
				},
			});
		},
	};
}
