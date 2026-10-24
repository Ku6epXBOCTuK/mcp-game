import type {
	GameEvent,
	GameState,
	PlayerId,
} from "../../domain/game/types.ts";

export type StoredGameState = {
	playerId: PlayerId;
	state: GameState;
	version: number;
	updatedAt: number;
};

export type EventPage = {
	events: GameEvent[];
	lastId: number;
	truncated: boolean;
};

export interface GameRepository {
	load(playerId: PlayerId): Promise<StoredGameState | null>;
	save(playerId: PlayerId, state: GameState, version: number): Promise<void>;
	appendEvents(playerId: PlayerId, events: GameEvent[]): Promise<void>;
	listEvents(playerId: PlayerId, limit: number): Promise<GameEvent[]>;
	listEventsSince(
		playerId: PlayerId,
		afterId: number,
		limit: number,
	): Promise<EventPage>;
	maxEventId(playerId: PlayerId): Promise<number>;
	createSnapshot(
		playerId: PlayerId,
		at: number,
		state: GameState,
	): Promise<void>;
	listSnapshots(
		playerId: PlayerId,
		limit: number,
	): Promise<{ at: number; state: GameState }[]>;
	latestSnapshot(playerId: PlayerId): Promise<GameState | null>;
}
