import type { ApiKeyService } from "../identity/api-key-service.ts";
import type { McpScope } from "../mcp/tool-result.ts";

export type ApiKeyResolution =
	| { ok: true; playerId: string; scopes: McpScope[] }
	| { ok: false; reason: "missing" | "invalid" };

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

export async function resolveApiKey(
	request: Request,
	service: ApiKeyService,
	options: { dev: boolean; now: number },
): Promise<ApiKeyResolution> {
	const raw = extractApiKey(request, options.dev);
	if (!raw) return { ok: false, reason: "missing" };
	const resolved = await service.resolve(raw, options.now);
	if (!resolved) return { ok: false, reason: "invalid" };
	const scopes: McpScope[] = resolved.scopes.includes("play")
		? ["read", "play"]
		: resolved.scopes.includes("read")
			? ["read"]
			: [];
	return { ok: true, playerId: resolved.playerId, scopes };
}
