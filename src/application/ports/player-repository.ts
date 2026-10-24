import type { PlayerId } from "../../domain/game/types.ts";

export type Player = {
	id: PlayerId;
	label: string;
	createdAt: number;
	lastSeenAt: number | null;
	lastReadEventId: number | null;
	meta: Record<string, unknown>;
};

export interface PlayerRepository {
	create(input: {
		id: PlayerId;
		label: string;
		createdAt: number;
		meta?: Record<string, unknown>;
	}): Promise<Player>;
	findById(id: PlayerId): Promise<Player | null>;
	list(): Promise<Player[]>;
	touchLastSeen(id: PlayerId, at: number): Promise<void>;
	setLastReadEventId(id: PlayerId, value: number): Promise<void>;
}
