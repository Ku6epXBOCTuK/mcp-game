import { xpToNext } from "../shared/curves.ts";
import type { GameState, SkillId } from "./types.ts";

export function gainXp(
	state: GameState,
	skill: SkillId,
	amount: number,
	xpBase: number,
	xpExponent: number,
): GameState {
	if (amount <= 0) return state;
	const current = state.skills[skill];
	if (!current) return state;
	let level = current.level;
	let xp = current.xp + amount;
	let need = xpToNext(level, xpBase, xpExponent);
	while (xp >= need) {
		xp -= need;
		level += 1;
		need = xpToNext(level, xpBase, xpExponent);
	}
	return {
		...state,
		skills: { ...state.skills, [skill]: { id: skill, level, xp } },
	};
}
