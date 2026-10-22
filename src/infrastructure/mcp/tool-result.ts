import type { z } from "zod";

export type McpScope = "read" | "play";

export type McpToolContext = {
	playerId: string;
	scopes: McpScope[];
};

export type McpToolResult = {
	content: { type: "text"; text: string }[];
	isError?: boolean;
};

export type McpToolDefinition = {
	name: string;
	title: string;
	description: string;
	inputSchema?: z.ZodType<
		unknown,
		unknown,
		z.core.$ZodTypeInternals<unknown, unknown>
	>;
	scopes: McpScope[];
	handler: (
		args: Record<string, unknown>,
		context: McpToolContext,
	) => Promise<McpToolResult>;
};

export function textResult(text: string): McpToolResult {
	return { content: [{ type: "text", text }] };
}

export function jsonResult(data: unknown): McpToolResult {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(message: string): McpToolResult {
	return { content: [{ type: "text", text: message }], isError: true };
}

export function errorResultFromDomain(error: {
	code: string;
	message: string;
}): McpToolResult {
	return errorResult(`${error.code}: ${error.message}`);
}

export function scopeError(missing: McpScope[]): McpToolResult {
	return errorResult(
		`NotSupported: у ключа нет прав (${missing.join(", ")}). Нужен ключ со scope "${missing[0]}".`,
	);
}
