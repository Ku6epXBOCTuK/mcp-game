import type { IncomingMessage, ServerResponse } from "node:http";

export type NodeRequestOptions = {
	host: string;
	port: number;
	maxBodyBytes?: number;
};

const DEFAULT_MAX_BODY = 4 * 1024 * 1024;

export async function readBody(
	request: IncomingMessage,
	maxBodyBytes = DEFAULT_MAX_BODY,
): Promise<Buffer> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of request) {
		const buffer = Buffer.isBuffer(chunk)
			? chunk
			: Buffer.from(chunk as string);
		size += buffer.length;
		if (size > maxBodyBytes) {
			throw new Error("PayloadTooLarge");
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks);
}

export function toWebRequest(
	request: IncomingMessage,
	body: Buffer,
	options: NodeRequestOptions,
): Request {
	const url = new URL(
		request.url ?? "/",
		`http://${options.host}:${options.port}`,
	);
	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const item of value) headers.append(name, item);
			continue;
		}
		headers.set(name, value);
	}
	const method = request.method ?? "GET";
	const hasBody = method !== "GET" && method !== "HEAD";
	return new Request(url, {
		method,
		headers,
		...(hasBody ? { body } : {}),
	});
}

export async function sendWebResponse(
	response: ServerResponse,
	webResponse: Response,
): Promise<void> {
	const headers: Record<string, string | string[]> = {};
	webResponse.headers.forEach((value, name) => {
		if (name === "set-cookie") {
			const existing = headers["set-cookie"];
			headers["set-cookie"] = Array.isArray(existing)
				? [...existing, value]
				: [value];
			return;
		}
		headers[name] = value;
	});
	response.writeHead(webResponse.status, headers);
	if (webResponse.body) {
		const buffer = Buffer.from(await webResponse.arrayBuffer());
		response.end(buffer);
		return;
	}
	response.end();
}
