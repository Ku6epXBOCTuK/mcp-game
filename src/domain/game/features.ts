import type { GameState } from "./types.ts";

export function hasFeature(state: GameState, feature: string): boolean {
	return (state.unlockedFeatures ?? []).includes(feature);
}
