import type { GameContent } from "../content/types.ts";
import type { GameState, MonsterId, SkillId } from "./types.ts";
import { createInitialState } from "./state.ts";
import { tick } from "./tick.ts";
import {
	startAction,
	buyUpgrade,
	cancelAction,
	upgradePrice,
} from "./actions.ts";
import { sellItem } from "./trade.ts";
import { claimQuest } from "./quest-rewards.ts";
import { prestige, previewPrestige } from "./prestige.ts";
import { questProgress, questCompleted } from "./quests.ts";

export const PAYBACK_MIN_SEC = 3 * 60;
export const PAYBACK_MAX_SEC = 15 * 60;
export const PRESTIGE_MIN_SEC = 2 * 60 * 60;
export const PRESTIGE_MAX_SEC = 6 * 60 * 60;
export const IDLE_MAX_RATIO = 0.6;
export const BOTTLENECK_SEC = 30 * 60;

export type SimulatorOptions = {
	content: GameContent;
	seed?: number;
	durationSec: number;
	stepSec?: number;
	startAt?: number;
};

export type StageMetric = {
	index: number;
	fromSec: number;
	toSec: number;
	income: number;
	goldPerMinute: number;
};

export type UpgradePurchase = {
	upgradeId: string;
	level: number;
	cost: number;
	atSec: number;
	paybackSec: number | null;
	measurable: boolean;
};

export type BalanceCriteria = {
	paybackInRange: boolean;
	prestigeInRange: boolean;
	idleWithinLimit: boolean;
	passed: boolean;
};

export type SimulationMetrics = {
	durationSec: number;
	timeToPrestigeSec: number | null;
	prestigeRuns: number;
	totalIncome: number;
	goldPerMinute: number;
	idleRatio: number;
	medianPaybackSec: number | null;
	stages: StageMetric[];
	purchases: UpgradePurchase[];
	bottlenecks: string[];
	criteria: BalanceCriteria;
	finalGold: number;
	finalLevels: Record<string, number>;
};

export type SimulationResult = {
	state: GameState;
	metrics: SimulationMetrics;
};

const RESOURCE_SKILL: Record<string, SkillId> = {
	wood: "chopping",
	log: "chopping",
	stick: "chopping",
	stone: "mining",
	iron_ore: "mining",
	copper_ore: "mining",
	coal: "mining",
	gold_ore: "mining",
	silver_ore: "mining",
	grass_fiber: "chopping",
	meat: "hunting",
	pelt: "hunting",
	fat: "hunting",
	bone: "hunting",
	claw: "hunting",
	feather: "hunting",
	milk: "hunting",
	herb: "magic",
	mushroom: "magic",
	berry: "magic",
};

const SELL_BUFFER = 4;

function skillOf(itemId: string): SkillId {
	return RESOURCE_SKILL[itemId] ?? "chopping";
}

function itemOf(content: GameContent, itemId: string) {
	return content.items.find((entry) => entry.id === itemId);
}

function productionMult(
	state: GameState,
	content: GameContent,
	skill: SkillId,
): number {
	let multiplier = 1;
	for (const upgrade of content.upgrades) {
		if (upgrade.effect.kind !== "productionMultiplier") continue;
		const level = state.upgrades[upgrade.id] ?? 0;
		if (level <= 0) continue;
		const target = upgrade.effect.skill;
		if (target && target !== skill) continue;
		multiplier += upgrade.effect.valuePerLevel * level;
	}
	return multiplier;
}

function gatherGoldPerMinute(
	state: GameState,
	content: GameContent,
	itemId: string,
): number {
	const item = itemOf(content, itemId);
	if (!item || item.type !== "resource") return 0;
	const skill = skillOf(itemId);
	const level = state.skills[skill]?.level ?? 1;
	const balance = content.balance;
	const rateBase = balance.rateBase[skill] ?? 0;
	const rate =
		rateBase *
		(1 + balance.skillRateK * level) *
		productionMult(state, content, skill);
	return rate * item.sellPrice;
}

function bestGather(
	state: GameState,
	content: GameContent,
): { itemId: string; perMinute: number } | null {
	let best: { itemId: string; perMinute: number } | null = null;
	for (const item of content.items) {
		if (item.type !== "resource" || item.sellPrice <= 0) continue;
		const perMinute = gatherGoldPerMinute(state, content, item.id);
		if (perMinute <= 0) continue;
		if (!best || perMinute > best.perMinute) {
			best = { itemId: item.id, perMinute };
		}
	}
	return best;
}

function skillGoldPerMinute(
	state: GameState,
	content: GameContent,
	skill: SkillId,
): number {
	let best = 0;
	for (const item of content.items) {
		if (item.type !== "resource" || item.sellPrice <= 0) continue;
		if (skillOf(item.id) !== skill) continue;
		best = Math.max(best, gatherGoldPerMinute(state, content, item.id));
	}
	return best;
}

function upgradeGoldGainPerMinute(
	state: GameState,
	content: GameContent,
	upgradeId: string,
): number {
	const upgrade = content.upgrades.find((entry) => entry.id === upgradeId);
	if (!upgrade) return 0;
	const effect = upgrade.effect;
	if (effect.kind === "productionMultiplier") {
		const skill = effect.skill;
		const base = skill
			? skillGoldPerMinute(state, content, skill)
			: totalGatherGoldPerMinute(state, content);
		return base * effect.valuePerLevel;
	}
	if (effect.kind === "passiveIncome") {
		return effect.valuePerLevel * 60;
	}
	return 0;
}

function totalGatherGoldPerMinute(
	state: GameState,
	content: GameContent,
): number {
	let total = 0;
	for (const skill of Object.keys(state.skills) as SkillId[]) {
		total += skillGoldPerMinute(state, content, skill);
	}
	return total;
}

function zoneUnlocked(
	state: GameState,
	content: GameContent,
	zoneId: string,
): boolean {
	const zone = content.zones.find((entry) => entry.id === zoneId);
	if (!zone) return false;
	const unlock = zone.unlock;
	if (unlock.kind === "quest") {
		const status = state.quests[unlock.quest]?.status;
		if (status === "completed" || status === "claimed") return true;
		const quest = content.quests.find((entry) => entry.id === unlock.quest);
		return quest ? questCompleted(state, quest) : false;
	}
	if (unlock.kind === "skillLevel") {
		return (state.skills[unlock.skill]?.level ?? 0) >= unlock.level;
	}
	return true;
}

type FightPlan = {
	monsterId: MonsterId;
	seconds: number;
	perMinute: number;
};

function monsterValue(content: GameContent, monsterId: string): number {
	const monster = content.monsters.find((entry) => entry.id === monsterId);
	if (!monster) return 0;
	let dropValue = 0;
	for (const drop of monster.dropTable) {
		const item = itemOf(content, drop.item);
		dropValue += (item?.sellPrice ?? 0) * drop.qty * drop.chance;
	}
	return monster.xp * 4 + dropValue;
}

function bestFight(state: GameState, content: GameContent): FightPlan | null {
	const balance = content.balance;
	const combatLevel = state.skills.combat?.level ?? 1;
	const dps =
		balance.playerDamageBase + balance.playerDamagePerLevel * combatLevel;
	let best: FightPlan | null = null;
	for (const monster of content.monsters) {
		if (!zoneUnlocked(state, content, monster.zone)) continue;
		const seconds = monster.hp / dps;
		if (seconds > 120) continue;
		const hits = Math.floor(seconds / monster.attackInterval);
		const incoming = hits * monster.damage;
		if (incoming >= state.health.hp * 0.6) continue;
		const perMinute = monsterValue(content, monster.id) / (seconds / 60);
		if (!best || perMinute > best.perMinute) {
			best = { monsterId: monster.id, seconds, perMinute };
		}
	}
	return best;
}

function questFightTarget(
	state: GameState,
	content: GameContent,
): MonsterId | null {
	for (const quest of content.quests) {
		const status = state.quests[quest.id]?.status;
		if (status === "claimed" || status === "completed") continue;
		for (const step of quest.steps) {
			if (step.kind !== "kill") continue;
			const killed = state.counters.killed[step.target] ?? 0;
			if (killed >= step.qty) continue;
			return step.target;
		}
	}
	return null;
}

function craftPlan(
	state: GameState,
	content: GameContent,
): { recipeId: string; gain: number; perMinute: number } | null {
	let best: { recipeId: string; gain: number; perMinute: number } | null = null;
	for (const recipe of content.recipes) {
		const level = state.skills[recipe.skill]?.level ?? 0;
		if (level < recipe.skillLevel) continue;
		let hasInputs = true;
		let inputValue = 0;
		for (const input of recipe.inputs) {
			const available = state.inventory[input.item] ?? 0;
			if (available < input.qty) {
				hasInputs = false;
				break;
			}
			const item = itemOf(content, input.item);
			inputValue += (item?.sellPrice ?? 0) * input.qty;
		}
		if (!hasInputs) continue;
		const output = itemOf(content, recipe.output.item);
		const gain = (output?.sellPrice ?? 0) * recipe.output.qty - inputValue;
		if (gain <= 0) continue;
		const perMinute = gain / (recipe.timeSec / 60);
		if (!best || perMinute > best.perMinute) {
			best = { recipeId: recipe.id, gain, perMinute };
		}
	}
	return best;
}

function nextUpgrade(
	state: GameState,
	content: GameContent,
): { id: string; cost: number } | null {
	let best: { id: string; cost: number } | null = null;
	for (const upgrade of content.upgrades) {
		const level = state.upgrades[upgrade.id] ?? 0;
		if (level >= upgrade.maxLevel) continue;
		const cost = upgradePrice(content, upgrade.id, level);
		if (!best || cost < best.cost) best = { id: upgrade.id, cost };
	}
	return best;
}

function craftInputNeeds(content: GameContent): Map<string, number> {
	const needs = new Map<string, number>();
	for (const recipe of content.recipes) {
		for (const input of recipe.inputs) {
			needs.set(input.item, (needs.get(input.item) ?? 0) + input.qty);
		}
	}
	return needs;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	if (sorted.length % 2 === 1) return sorted[middle] ?? null;
	const a = sorted[middle - 1] ?? 0;
	const b = sorted[middle] ?? 0;
	return (a + b) / 2;
}

export function simulate(options: SimulatorOptions): SimulationResult {
	const content = options.content;
	const stepSec = options.stepSec ?? 60;
	const startAt = options.startAt ?? 0;
	const seed = options.seed ?? 1;
	let state = createInitialState("simulator", seed, startAt);
	const durationSec = options.durationSec;
	const endAt = startAt + durationSec;

	const stageCount = 8;
	const stageSec = durationSec / stageCount;
	const stageIncome: number[] = Array.from({ length: stageCount }, () => 0);
	const purchases: UpgradePurchase[] = [];
	const stepIncome: number[] = [];
	let totalIncome = 0;
	let idleSec = 0;
	let timeToPrestigeSec: number | null = null;
	let prestigeRuns = 0;
	const inputNeeds = craftInputNeeds(content);

	for (let now = startAt; now < endAt; now += stepSec) {
		const elapsedSec = now - startAt;
		const goldStart = state.wallet.gold;
		let spent = 0;

		for (const quest of content.quests) {
			const progress = questProgress(state, quest);
			if (progress.status !== "completed") continue;
			const result = claimQuest(state, content, quest.id, now);
			if (result.isOk()) state = result.value;
		}

		const plan = craftPlan(state, content);
		const fight = bestFight(state, content);
		const questTarget = questFightTarget(state, content);
		const gather = bestGather(state, content);

		if (state.activeAction && state.activeAction.kind === "gather" && gather) {
			const active = state.activeAction;
			const current = gatherGoldPerMinute(state, content, active.targetId);
			const better =
				(plan ? plan.perMinute : 0) > current ||
				(fight ? fight.perMinute : 0) > current ||
				(questTarget !== null && questTarget !== active.targetId);
			if (better) {
				const cancelled = cancelAction(state, now);
				if (cancelled.isOk()) state = cancelled.value;
			}
		}

		if (!state.activeAction) {
			const started = startBestAction(
				state,
				content,
				{
					fight,
					questTarget,
					plan,
					gather,
				},
				now,
			);
			if (started) state = started;
		}
		const engaged = state.activeAction !== null;

		const upgrade = nextUpgrade(state, content);
		if (upgrade && state.wallet.gold >= upgrade.cost) {
			const gainPerMinute = upgradeGoldGainPerMinute(
				state,
				content,
				upgrade.id,
			);
			const result = buyUpgrade(state, content, upgrade.id, now);
			if (result.isOk()) {
				state = result.value;
				spent += upgrade.cost;
				purchases.push({
					upgradeId: upgrade.id,
					level: state.upgrades[upgrade.id] ?? 0,
					cost: upgrade.cost,
					atSec: elapsedSec,
					paybackSec:
						gainPerMinute > 0
							? Math.round((upgrade.cost / gainPerMinute) * 60)
							: null,
					measurable: gainPerMinute > 0,
				});
			}
		}

		const preview = previewPrestige(state, content);
		if (preview.points > 0) {
			const result = prestige(state, content, now);
			if (result.isOk()) {
				state = result.value;
				prestigeRuns += 1;
				if (timeToPrestigeSec === null) timeToPrestigeSec = elapsedSec;
			}
		}

		state = tick(state, { content, now });

		for (const item of content.items) {
			if (item.sellPrice <= 0) continue;
			const qty = state.inventory[item.id] ?? 0;
			if (qty <= 0) continue;
			const keep = (inputNeeds.get(item.id) ?? 0) * SELL_BUFFER;
			const sellQty = Math.floor(qty - keep);
			if (sellQty <= 0) continue;
			const sold = sellItem(state, content, item.id, sellQty, now);
			if (sold.isOk()) state = sold.value;
		}

		const goldEnd = state.wallet.gold;
		const income = goldEnd - goldStart + spent;
		if (income > 0) {
			totalIncome += income;
			const stageIndex = Math.min(
				stageCount - 1,
				Math.floor(elapsedSec / stageSec),
			);
			stageIncome[stageIndex] = (stageIncome[stageIndex] ?? 0) + income;
		}
		stepIncome.push(income);

		if (!engaged) idleSec += stepSec;
	}

	const stages: StageMetric[] = stageIncome.map((income, index) => ({
		index,
		fromSec: Math.round(index * stageSec),
		toSec: Math.round((index + 1) * stageSec),
		income: Math.round(income),
		goldPerMinute: Math.round((income / (stageSec / 60)) * 100) / 100,
	}));

	const bottlenecks = purchases
		.filter(
			(purchase) =>
				purchase.measurable &&
				(purchase.paybackSec === null || purchase.paybackSec > BOTTLENECK_SEC),
		)
		.map((purchase) => purchase.upgradeId);

	const paybacks = purchases
		.filter((purchase) => purchase.measurable)
		.map((purchase) => purchase.paybackSec)
		.filter((value): value is number => value !== null);
	const medianPaybackSec = median(paybacks);
	const idleRatio = idleSec / durationSec;
	const prestigeTime = timeToPrestigeSec;
	const criteria: BalanceCriteria = {
		paybackInRange:
			medianPaybackSec !== null &&
			medianPaybackSec >= PAYBACK_MIN_SEC &&
			medianPaybackSec <= PAYBACK_MAX_SEC,
		prestigeInRange:
			prestigeTime !== null &&
			prestigeTime >= PRESTIGE_MIN_SEC &&
			prestigeTime <= PRESTIGE_MAX_SEC,
		idleWithinLimit: idleRatio <= IDLE_MAX_RATIO,
		passed: false,
	};
	criteria.passed =
		criteria.paybackInRange &&
		criteria.prestigeInRange &&
		criteria.idleWithinLimit;

	const finalLevels: Record<string, number> = {};
	for (const [id, skill] of Object.entries(state.skills)) {
		finalLevels[id] = skill.level;
	}

	return {
		state,
		metrics: {
			durationSec,
			timeToPrestigeSec: prestigeTime,
			prestigeRuns,
			totalIncome: Math.round(totalIncome),
			goldPerMinute: Math.round((totalIncome / (durationSec / 60)) * 100) / 100,
			idleRatio: Math.round(idleRatio * 1000) / 1000,
			medianPaybackSec:
				medianPaybackSec === null ? null : Math.round(medianPaybackSec),
			stages,
			purchases,
			bottlenecks: [...new Set(bottlenecks)],
			criteria,
			finalGold: state.wallet.gold,
			finalLevels,
		},
	};
}

type ActionChoices = {
	fight: FightPlan | null;
	questTarget: MonsterId | null;
	plan: { recipeId: string; gain: number; perMinute: number } | null;
	gather: { itemId: string; perMinute: number } | null;
};

function startBestAction(
	state: GameState,
	content: GameContent,
	choices: ActionChoices,
	now: number,
): GameState | null {
	if (choices.questTarget) {
		const result = startAction(
			state,
			content,
			{
				kind: "fight",
				monsterId: choices.questTarget,
			},
			now,
		);
		if (result.isOk()) return result.value;
	}

	const gatherValue = choices.gather?.perMinute ?? 0;
	const fightValue = choices.fight?.perMinute ?? 0;
	const craftValue = choices.plan?.perMinute ?? 0;

	if (craftValue > gatherValue && craftValue >= fightValue && choices.plan) {
		const result = startAction(
			state,
			content,
			{
				kind: "craft",
				recipeId: choices.plan.recipeId,
			},
			now,
		);
		if (result.isOk()) return result.value;
	}

	if (fightValue > gatherValue && choices.fight) {
		const result = startAction(
			state,
			content,
			{
				kind: "fight",
				monsterId: choices.fight.monsterId,
			},
			now,
		);
		if (result.isOk()) return result.value;
	}

	if (choices.gather) {
		const result = startAction(
			state,
			content,
			{
				kind: "gather",
				skill: skillOf(choices.gather.itemId),
				targetId: choices.gather.itemId,
			},
			now,
		);
		if (result.isOk()) return result.value;
	}

	if (choices.plan) {
		const result = startAction(
			state,
			content,
			{
				kind: "craft",
				recipeId: choices.plan.recipeId,
			},
			now,
		);
		if (result.isOk()) return result.value;
	}

	return null;
}
