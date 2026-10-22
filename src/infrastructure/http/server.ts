import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { McpRoute } from "./mcp-route.ts";
import type { DebugRoute } from "./debug-route.ts";
import { readBody, sendWebResponse, toWebRequest } from "./node-adapter.ts";

export type HttpServerOptions = {
	route: McpRoute;
	debug: DebugRoute;
	publicDir: string;
	host: string;
	port: number;
};

export type HttpServerHandle = {
	server: ReturnType<typeof createServer>;
	listen: () => Promise<void>;
	close: () => Promise<void>;
};

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
};

export function createHttpServer(options: HttpServerOptions): HttpServerHandle {
	const server = createServer((request, response) => {
		void handle(request, response, options).catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			if (message === "PayloadTooLarge") {
				response.writeHead(413, {
					"content-type": "application/json; charset=utf-8",
				});
				response.end(JSON.stringify({ error: "PayloadTooLarge" }));
				return;
			}
			response.writeHead(500, {
				"content-type": "application/json; charset=utf-8",
			});
			response.end(JSON.stringify({ error: "InternalError" }));
		});
	});

	return {
		server,
		listen: () =>
			new Promise<void>((resolve) => {
				server.listen(options.port, options.host, () => resolve());
			}),
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.closeAllConnections();
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

async function handle(
	request: IncomingMessage,
	response: ServerResponse,
	options: HttpServerOptions,
): Promise<void> {
	const url = new URL(
		request.url ?? "/",
		`http://${options.host}:${options.port}`,
	);
	const pathname = url.pathname;

	if (pathname === "/mcp") {
		const body = await readBody(request);
		const webRequest = toWebRequest(request, body, {
			host: options.host,
			port: options.port,
		});
		const webResponse = await options.route.handle(webRequest);
		await sendWebResponse(response, webResponse);
		return;
	}

	if (pathname.startsWith("/api/")) {
		const body = await readBody(request);
		const webRequest = toWebRequest(request, body, {
			host: options.host,
			port: options.port,
		});
		const webResponse = await options.debug.handle(webRequest);
		await sendWebResponse(response, webResponse);
		return;
	}

	if (request.method !== "GET" && request.method !== "HEAD") {
		response.writeHead(405, {
			"content-type": "application/json; charset=utf-8",
		});
		response.end(JSON.stringify({ error: "MethodNotAllowed" }));
		return;
	}

	await serveStatic(pathname, response, options.publicDir);
}

async function serveStatic(
	pathname: string,
	response: ServerResponse,
	publicDir: string,
): Promise<void> {
	const relative = pathname === "/" ? "index.html" : pathname.slice(1);
	const target = join(
		publicDir,
		normalize(relative).replace(/^(\.\.[/\\])+/, ""),
	);
	try {
		const data = await readFile(target);
		response.writeHead(200, {
			"content-type": MIME[extname(target)] ?? "application/octet-stream",
			"cache-control": "no-store",
		});
		response.end(data);
	} catch {
		response.writeHead(404, {
			"content-type": "text/plain; charset=utf-8",
		});
		response.end("NotFound");
	}
}
