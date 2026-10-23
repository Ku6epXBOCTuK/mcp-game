import { hasFeature } from "./features.ts";
import type { GameState } from "./types.ts";
import type { GameContent, ZoneContent } from "../content/types.ts";

export function travelToZone(
	state: GameState,
	content: GameContent,
	zoneId: string,
	now: number,
): GameState {
	const zone = content.zones.find((entry: ZoneContent) => entry.id === zoneId);
	if (!zone) return state;
	const travelTimeSec = content.balance.travelTimeSec ?? 30;
	const travelUntil = hasFeature(state, "fast_travel")
		? now
		: now + travelTimeSec * 1000;
	return { ...state, activeZone: zoneId, travelUntil, updatedAt: now };
}
