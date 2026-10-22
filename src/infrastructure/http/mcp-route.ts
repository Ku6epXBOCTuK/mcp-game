import { createMcpHandler } from "@modelcontextprotocol/server";
import type { GameService } from "../../application/use-cases/game-service.ts";
import type { ApiKeyService } from "../identity/api-key-service.ts";
import { createMcpServerFactory } from "../mcp/server.ts";
import type { McpScope } from "../mcp/tool-result.ts";
import { authorize, type AuthMode } from "./auth.ts";

export type McpRouteDeps = {
	games: GameService;
	keys: ApiKeyService;
	auth: AuthMode;
	dev: boolean;
	now: () => number;
};

export type McpRoute = {
	handle: (request: Request) => Promise<Response>;
};

function jsonResponse(status: number, body: Record<string, unknown>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
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
			const context = await authorize(request, {
				games: deps.games,
				keys: deps.keys,
				auth: deps.auth,
				dev: deps.dev,
				now: deps.now(),
			});
			if (!context.ok) {
				return jsonResponse(context.status, { error: context.body });
			}
			return handler.fetch(request, {
				authInfo: {
					token: context.token,
					clientId: context.playerId,
					scopes: context.scopes,
				},
			});
		},
	};
}
