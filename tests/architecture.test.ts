import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "src");

function collect(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...collect(full));
		else if (entry.endsWith(".ts")) out.push(full);
	}
	return out;
}

test("layer layout exists", () => {
	for (const dir of [
		"domain/game",
		"domain/shared",
		"application/ports",
		"application/use-cases",
		"infrastructure/persistence",
		"infrastructure/content",
		"infrastructure/identity",
		"infrastructure/mcp",
		"infrastructure/http",
		"infrastructure/sim",
		"bootstrap",
	]) {
		assert.doesNotThrow(() => statSync(join(ROOT, dir)), `missing ${dir}`);
	}
});

test("domain and application stay free of node and transport imports", () => {
	const forbidden = [
		/from\s+"node:/,
		/from\s+"(mcp-handler|@modelcontextprotocol)/,
	];
	for (const layer of ["domain", "application"]) {
		for (const file of collect(join(ROOT, layer))) {
			const source = readFileSync(file, "utf8");
			for (const pattern of forbidden) {
				assert.doesNotMatch(
					source,
					pattern,
					`${file} must not import ${pattern.source}`,
				);
			}
		}
	}
});
