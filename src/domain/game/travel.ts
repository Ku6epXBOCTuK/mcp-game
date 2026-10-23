import { hasFeature } from "./features";
import type { GameState } from "./types";
import type { GameContent } from "../content/types";

export function travelToZone(
	state: GameState,
	content: GameContent,
	zoneId: string,
	now: number,
): GameState {
	const travelTimeSec = content.balance.travelTimeSec ?? 30;
	const travelUntil = hasFeature(state, "fast_travel")
		? now
		: now + travelTimeSec * 1000;
	return { ...state, travelUntil, updatedAt: now };
}
