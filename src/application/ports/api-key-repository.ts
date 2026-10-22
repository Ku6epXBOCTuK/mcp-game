export type ApiKeyRecord = {
	id: string;
	playerId: string;
	keyPrefix: string;
	label: string | null;
	createdAt: number;
	lastUsedAt: number | null;
	revokedAt: number | null;
	scopes: string[];
};

export interface ApiKeyRepository {
	create(input: {
		id: string;
		playerId: string;
		keyHash: string;
		keyPrefix: string;
		label: string | null;
		createdAt: number;
		scopes: string[];
	}): Promise<ApiKeyRecord>;
	findByHash(keyHash: string): Promise<ApiKeyRecord | null>;
	findById(id: string): Promise<ApiKeyRecord | null>;
	listByPlayer(playerId: string): Promise<ApiKeyRecord[]>;
	revoke(id: string, at: number): Promise<void>;
	touchLastUsed(id: string, at: number): Promise<void>;
}
