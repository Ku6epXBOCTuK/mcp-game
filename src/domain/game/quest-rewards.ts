import {
	type Result,
	ok,
	err,
	questAlreadyClaimed,
	questNotCompleted,
} from "../shared/result.ts";
import type { GameContent } from "../content/types.ts";
import type { GameState, QuestId, SkillId } from "./types.ts";
import { questCompleted } from "./quests.ts";

type DomainError = import("../shared/errors.ts").DomainError;

export function claimQuest(
	state: GameState,
	content: GameContent,
	questId: QuestId,
	now: number,
): Result<GameState, DomainError> {
	const quest = content.quests.find((entry) => entry.id === questId);
	if (!quest) {
		return err({
			code: "NotSupported",
			message: `Неизвестный квест "${questId}".`,
			feature: `quest:${questId}`,
		});
	}
	const status = state.quests[questId]?.status;
	if (status === "claimed") return questAlreadyClaimed(questId);
	if (!questCompleted(state, quest)) return questNotCompleted(questId);

	const inventory = { ...state.inventory };
	let gold = state.wallet.gold;
	const skills = { ...state.skills };
	const upgrades = { ...state.upgrades };

	for (const reward of quest.rewards) {
		switch (reward.kind) {
			case "gold":
				gold += reward.qty;
				break;
			case "item":
				inventory[reward.id] = (inventory[reward.id] ?? 0) + reward.qty;
				break;
			case "skillLevel": {
				const skill = skills[reward.id as SkillId];
				if (skill) {
					skills[reward.id as SkillId] = {
						...skill,
						level: skill.level + reward.qty,
					};
				}
				break;
			}
			case "upgrade":
				upgrades[reward.id] = (upgrades[reward.id] ?? 0) + reward.qty;
				break;
		}
	}

	return ok({
		...state,
		wallet: { ...state.wallet, gold },
		inventory,
		skills,
		upgrades,
		quests: {
			...state.quests,
			[questId]: {
				id: questId,
				status: "claimed",
				progress: quest.steps.length,
			},
		},
		updatedAt: now,
	});
}
