import type { GameService } from "../../application/use-cases/game-service.ts";
import type { ApiKeyService } from "../identity/api-key-service.ts";
import type { McpScope } from "../mcp/tool-result.ts";

export type AuthMode = "off" | "keys";

export type AuthContext =
	| { ok: true; playerId: string; scopes: McpScope[]; token: string }
	| { ok: false; status: number; body: string };

export function extractApiKey(request: Request, dev: boolean): string | null {
	const authorization = request.headers.get("authorization");
	if (authorization) {
		const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
		if (match?.[1]) return match[1].trim();
	}
	const header = request.headers.get("x-api-key");
	if (header) return header.trim();
	if (dev) {
		const key = new URL(request.url).searchParams.get("key");
		if (key) return key.trim();
	}
	return null;
}

export function scopesOf(scopes: string[]): McpScope[] {
	if (scopes.includes("play")) return ["read", "play"];
	if (scopes.includes("read")) return ["read"];
	return [];
}

export async function authorize(
	request: Request,
	deps: {
		games: GameService;
		keys: ApiKeyService;
		auth: AuthMode;
		dev: boolean;
		now: number;
	},
): Promise<AuthContext> {
	const raw = extractApiKey(request, deps.dev);
	if (raw) {
		const resolved = await deps.keys.resolve(raw, deps.now);
		if (resolved) {
			return {
				ok: true,
				playerId: resolved.playerId,
				scopes: scopesOf(resolved.scopes),
				token: raw,
			};
		}
		if (deps.auth === "keys") {
			return {
				ok: false,
				status: 403,
				body: "API-ключ не найден или отозван.",
			};
		}
	}
	if (deps.auth === "keys") {
		return {
			ok: false,
			status: 401,
			body: "Отсутствует API-ключ. Передайте Authorization: Bearer <key>.",
		};
	}
	const fallback = await deps.games.firstPlayerId();
	if (!fallback) {
		return {
			ok: false,
			status: 404,
			body: "Игроков нет: выполните npm run keys create.",
		};
	}
	return {
		ok: true,
		playerId: fallback,
		scopes: ["read", "play"],
		token: raw ?? "",
	};
}
