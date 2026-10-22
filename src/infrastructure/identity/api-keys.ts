import { createHash, randomBytes } from "node:crypto";

const ALPHABET =
	"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const KEY_PREFIX = "mcp_live_";
const KEY_BODY_LENGTH = 32;

export type GeneratedApiKey = {
	key: string;
	hash: string;
	prefix: string;
};

function randomBase62(length: number): string {
	const limit = 256 - (256 % ALPHABET.length);
	let out = "";
	while (out.length < length) {
		const bytes = randomBytes(length);
		for (const byte of bytes) {
			if (byte >= limit) continue;
			out += ALPHABET[byte % ALPHABET.length];
			if (out.length === length) break;
		}
	}
	return out;
}

export function generateApiKey(): GeneratedApiKey {
	const key = `${KEY_PREFIX}${randomBase62(KEY_BODY_LENGTH)}`;
	return { key, hash: hashApiKey(key), prefix: keyPrefix(key) };
}

export function hashApiKey(key: string): string {
	return createHash("sha256").update(key, "utf8").digest("hex");
}

export function keyPrefix(key: string): string {
	return key.slice(0, KEY_PREFIX.length + 4);
}

export function isApiKeyFormat(key: string): boolean {
	if (!key.startsWith(KEY_PREFIX)) return false;
	const body = key.slice(KEY_PREFIX.length);
	if (body.length !== KEY_BODY_LENGTH) return false;
	for (const char of body) {
		if (!ALPHABET.includes(char)) return false;
	}
	return true;
}
