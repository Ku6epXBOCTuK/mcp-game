import type { GameContent, QuestContent, QuestStep } from "../content/types.ts";
import type { GameState, QuestState, QuestStatus } from "./types.ts";

export type QuestStepProgress = {
	step: QuestStep;
	current: number;
	required: number;
	done: boolean;
};

export type QuestProgress = {
	quest: QuestContent;
	status: QuestStatus;
	completedSteps: number;
	totalSteps: number;
	steps: QuestStepProgress[];
};

function stepProgress(state: GameState, step: QuestStep): QuestStepProgress {
	let current = 0;
	switch (step.kind) {
		case "collect":
			current =
				(state.counters.gathered[step.target] ?? 0) +
				(state.counters.craftedItems[step.target] ?? 0);
			break;
		case "craft":
			current = state.counters.crafted[step.target] ?? 0;
			break;
		case "kill":
			current = state.counters.killed[step.target] ?? 0;
			break;
		case "level":
			current =
				state.skills[step.target as keyof GameState["skills"]]?.level ?? 0;
			break;
		case "upgrade":
			current = state.upgrades[step.target] ?? 0;
			break;
	}
	return {
		step,
		current,
		required: step.qty,
		done: current >= step.qty,
	};
}

export function questProgress(
	state: GameState,
	quest: QuestContent,
): QuestProgress {
	const steps = quest.steps.map((step) => stepProgress(state, step));
	const stored = state.quests[quest.id];
	let status: QuestStatus = stored?.status ?? "available";
	if (status === "claimed") {
		return {
			quest,
			status,
			completedSteps: steps.length,
			totalSteps: steps.length,
			steps: steps.map((step) => ({
				...step,
				current: step.required,
				done: true,
			})),
		};
	}
	const completedSteps = steps.filter((entry) => entry.done).length;
	if (completedSteps === steps.length && steps.length > 0) {
		status = "completed";
	} else if (completedSteps > 0) {
		status = "in-progress";
	} else {
		status = "available";
	}
	return {
		quest,
		status,
		completedSteps,
		totalSteps: steps.length,
		steps,
	};
}

export function allQuestProgress(
	state: GameState,
	content: GameContent,
): QuestProgress[] {
	return content.quests.map((quest) => questProgress(state, quest));
}

export function questCompleted(state: GameState, quest: QuestContent): boolean {
	const steps = quest.steps.map((step) => stepProgress(state, step));
	if (steps.length === 0) return false;
	return steps.every((entry) => entry.done);
}

export function withQuestStatus(
	state: GameState,
	questId: string,
	status: QuestStatus,
): GameState {
	const existing: QuestState = state.quests[questId] ?? {
		id: questId,
		status,
		progress: 0,
	};
	return {
		...state,
		quests: {
			...state.quests,
			[questId]: { ...existing, status },
		},
	};
}
