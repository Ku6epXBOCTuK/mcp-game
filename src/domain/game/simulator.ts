import type { GameContent } from "../content/types.ts";
import type { GameState, MonsterId, SkillId } from "./types.ts";
import { createInitialState } from "./state.ts";
import { tick } from "./tick.ts";
import {
	startAction,
	buyUpgrade,
	cancelAction,
	upgradePrice,
	type StartActionCommand,
} from "./actions.ts";
import { sellItem } from "./trade.ts";
import { claimQuest } from "./quest-rewards.ts";
import { prestige, previewPrestige } from "./prestige.ts";
import { questProgress, questCompleted } from "./quests.ts";
import { forecastCombat, playerDpsFor, type CombatForecast } from "./combat.ts";
import { maxHpFor } from "./health.ts";

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

function skillOf(content: GameContent, itemId: string): SkillId | null {
	return itemOf(content, itemId)?.skill ?? null;
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

function canGather(
	state: GameState,
	item: GameContent["items"][number],
): boolean {
	if (!item.skill) return false;
	const level = state.skills[item.skill]?.level ?? 0;
	return level >= (item.skillLevel ?? 1);
}

function gatherGoldPerMinute(
	state: GameState,
	content: GameContent,
	itemId: string,
): number {
	const item = itemOf(content, itemId);
	if (!item || !canGather(state, item)) return 0;
	const skill = item.skill;
	if (!skill) return 0;
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
		if (!item.skill || item.sellPrice <= 0) continue;
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
		if (!item.skill || item.sellPrice <= 0) continue;
		if (skillOf(content, item.id) !== skill) continue;
		best = Math.max(best, gatherGoldPerMinute(state, content, item.id));
	}
	return best;
}

function craftGoldPerMinute(
	state: GameState,
	content: GameContent,
	skill: SkillId,
): number {
	let best = 0;
	for (const recipe of content.recipes) {
		if (recipe.skill !== skill) continue;
		const level = state.skills[recipe.skill]?.level ?? 0;
		if (level < recipe.skillLevel) continue;
		const output = itemOf(content, recipe.output.item);
		const outputValue = (output?.sellPrice ?? 0) * recipe.output.qty;
		let inputValue = 0;
		let hasInputs = true;
		for (const input of recipe.inputs) {
			if ((state.inventory[input.item] ?? 0) < input.qty) {
				hasInputs = false;
				break;
			}
			inputValue += (itemOf(content, input.item)?.sellPrice ?? 0) * input.qty;
		}
		if (!hasInputs) continue;
		const gain = outputValue - inputValue;
		if (gain <= 0) continue;
		const speed =
			(1 + content.balance.skillRateK * level) *
			productionMult(state, content, skill);
		best = Math.max(best, ((gain * 60) / recipe.timeSec) * speed);
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
		const gatherBase = skill
			? skillGoldPerMinute(state, content, skill)
			: totalGatherGoldPerMinute(state, content);
		const craftBase = skill ? craftGoldPerMinute(state, content, skill) : 0;
		return (gatherBase + craftBase) * effect.valuePerLevel;
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
	forecast: CombatForecast;
};

const MAX_FIGHT_SEC = 120;

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

function fightPlan(
	state: GameState,
	content: GameContent,
	monsterId: MonsterId,
): FightPlan | null {
	const monster = content.monsters.find((entry) => entry.id === monsterId);
	if (!monster) return null;
	const forecast = forecastCombat({
		monster,
		monsterHpLeft: monster.hp,
		nextMonsterHitInSec: monster.attackInterval,
		playerDps: playerDpsFor(state, content),
		playerHp: state.health.hp,
		playerMaxHp: maxHpFor(state, content),
	});
	if (forecast.timeToKillSec === null) return null;
	return {
		monsterId,
		seconds: forecast.timeToKillSec,
		perMinute: monsterValue(content, monsterId) / (forecast.timeToKillSec / 60),
		forecast,
	};
}

function safeMargin(forecast: CombatForecast): boolean {
	if (forecast.timeToKillSec === null) return false;
	const interval = forecast.monsterAttackInterval;
	const hits = Math.max(0, Math.ceil(forecast.timeToKillSec / interval) - 1);
	const taken = hits * forecast.monsterDamage;
	return forecast.playerHp - taken >= forecast.playerMaxHp * 0.4;
}

function bestFight(state: GameState, content: GameContent): FightPlan | null {
	let best: FightPlan | null = null;
	for (const monster of content.monsters) {
		if (!zoneUnlocked(state, content, monster.zone)) continue;
		const plan = fightPlan(state, content, monster.id);
		if (!plan) continue;
		if (plan.seconds > MAX_FIGHT_SEC) continue;
		if (!plan.forecast.canWin) continue;
		if (!safeMargin(plan.forecast)) continue;
		if (!best || plan.perMinute > best.perMinute) {
			best = plan;
		}
	}
	return best;
}

type QuestPlan = {
	questId: string;
	kind: "gather" | "craft" | "fight";
	targetId: string;
	leveling: boolean;
	skill?: SkillId | undefined;
	keepRecipeId?: string | undefined;
};

function inputPlan(
	state: GameState,
	content: GameContent,
	itemId: string,
	depth = 0,
): { kind: "gather" | "craft"; targetId: string } | null {
	for (const recipe of content.recipes) {
		if (recipe.output.item !== itemId) continue;
		if ((state.skills[recipe.skill]?.level ?? 0) < recipe.skillLevel) {
			const locked = lockedProducerPlan(state, content, recipe);
			if (locked) return locked;
			continue;
		}
		const missing = recipe.inputs.find(
			(input) => (state.inventory[input.item] ?? 0) < input.qty,
		);
		if (!missing) return { kind: "craft", targetId: recipe.id };
		if (depth < 2) {
			const nested = inputPlan(state, content, missing.item, depth + 1);
			if (nested) return nested;
		}
	}
	const item = itemOf(content, itemId);
	if (item && item.skill) {
		return { kind: "gather", targetId: itemId };
	}
	return null;
}

function lockedProducerPlan(
	state: GameState,
	content: GameContent,
	recipe: GameContent["recipes"][number],
): { kind: "gather"; targetId: string } | null {
	for (const input of recipe.inputs) {
		const item = itemOf(content, input.item);
		if (item && canGather(state, item)) {
			return { kind: "gather", targetId: item.id };
		}
	}
	const fallback = gatherForSkill(state, content, recipe.skill);
	return fallback ? { kind: "gather", targetId: fallback } : null;
}

function gatherForSkill(
	state: GameState,
	content: GameContent,
	skill: SkillId,
): string | null {
	let best: { itemId: string; perMinute: number } | null = null;
	for (const item of content.items) {
		if (!item.skill || item.skill !== skill) continue;
		const perMinute = gatherGoldPerMinute(state, content, item.id);
		if (perMinute <= 0) continue;
		if (!best || perMinute > best.perMinute) {
			best = { itemId: item.id, perMinute };
		}
	}
	return best?.itemId ?? null;
}

function craftForSkill(
	state: GameState,
	content: GameContent,
	skill: SkillId,
): { kind: "gather" | "craft"; targetId: string } | null {
	for (const recipe of content.recipes) {
		if (recipe.skill !== skill) continue;
		if ((state.skills[recipe.skill]?.level ?? 0) < recipe.skillLevel) continue;
		const missing = recipe.inputs.find(
			(input) => (state.inventory[input.item] ?? 0) < input.qty,
		);
		if (!missing) return { kind: "craft", targetId: recipe.id };
		const plan = inputPlan(state, content, missing.item);
		if (plan) return plan;
	}
	return null;
}

function goalRecipeForSkill(
	state: GameState,
	content: GameContent,
	skill: SkillId,
): string | null {
	for (const recipe of content.recipes) {
		if (recipe.skill !== skill) continue;
		if ((state.skills[recipe.skill]?.level ?? 0) < recipe.skillLevel) continue;
		return recipe.id;
	}
	return null;
}

function skillPlan(
	state: GameState,
	content: GameContent,
	skill: SkillId,
): { kind: "gather" | "craft"; targetId: string; skill: SkillId } | null {
	const craft = craftForSkill(state, content, skill);
	if (craft) return { ...craft, skill };
	const itemId = gatherForSkill(state, content, skill);
	if (itemId) return { kind: "gather", targetId: itemId, skill };
	return null;
}

// NOTE: a collect step may target a craftable item, so its producer recipe
// needs the same skill and input handling as a direct craft step.
function craftRecipePlan(
	state: GameState,
	content: GameContent,
	questId: string,
	recipe: GameContent["recipes"][number],
): QuestPlan | null {
	if ((state.skills[recipe.skill]?.level ?? 0) < recipe.skillLevel) {
		const skill = skillPlan(state, content, recipe.skill);
		return skill ? { questId, ...skill, leveling: true } : null;
	}
	const missing = recipe.inputs.find(
		(input) => (state.inventory[input.item] ?? 0) < input.qty,
	);
	if (missing) {
		const plan = inputPlan(state, content, missing.item);
		return plan ? { questId, ...plan, leveling: false } : null;
	}
	return { questId, kind: "craft", targetId: recipe.id, leveling: false };
}

function questStepPlan(
	state: GameState,
	content: GameContent,
	quest: GameContent["quests"][number],
): QuestPlan | null {
	const progress = questProgress(state, quest);
	for (const entry of progress.steps) {
		if (entry.done) continue;
		const step = entry.step;
		if (step.kind === "collect") {
			const item = itemOf(content, step.target);
			if (!item) return null;
			if (item.skill) {
				if (!canGather(state, item)) {
					const skill = skillPlan(state, content, item.skill);
					return skill ? { questId: quest.id, ...skill, leveling: true } : null;
				}
				return {
					questId: quest.id,
					kind: "gather",
					targetId: item.id,
					leveling: false,
				};
			}
			const recipe = content.recipes.find(
				(candidate) => candidate.output.item === step.target,
			);
			if (!recipe) return null;
			return craftRecipePlan(state, content, quest.id, recipe);
		}
		if (step.kind === "craft") {
			const recipe = content.recipes.find(
				(candidate) => candidate.id === step.target,
			);
			if (!recipe) return null;
			return craftRecipePlan(state, content, quest.id, recipe);
		}
		if (step.kind === "kill") {
			const monster = content.monsters.find(
				(candidate) => candidate.id === step.target,
			);
			if (!monster) return null;
			if (!zoneUnlocked(state, content, monster.zone)) return null;
			const plan = fightPlan(state, content, monster.id);
			if (!plan || !plan.forecast.canWin) return null;
			return {
				questId: quest.id,
				kind: "fight",
				targetId: monster.id,
				leveling: false,
			};
		}
		if (step.kind === "level") {
			const skill = step.target as SkillId;
			const plan = skillPlan(state, content, skill);
			return plan ? { questId: quest.id, ...plan, leveling: true } : null;
		}
		return null;
	}
	return null;
}

function questPlan(state: GameState, content: GameContent): QuestPlan | null {
	for (const quest of content.quests) {
		const status = state.quests[quest.id]?.status;
		if (status === "claimed" || status === "completed") continue;
		const plan = questStepPlan(state, content, quest);
		if (!plan) continue;
		const keepRecipeId = questCraftRecipe(state, content, quest);
		return keepRecipeId ? { ...plan, keepRecipeId } : plan;
	}
	return null;
}

function questCraftRecipe(
	state: GameState,
	content: GameContent,
	quest: GameContent["quests"][number],
): string | undefined {
	const progress = questProgress(state, quest);
	for (const entry of progress.steps) {
		if (entry.done) continue;
		if (entry.step.kind === "craft") return entry.step.target;
		if (entry.step.kind === "collect") {
			const producer = content.recipes.find(
				(candidate) => candidate.output.item === entry.step.target,
			);
			if (producer) return producer.id;
		}
	}
	return undefined;
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

const MAX_UPGRADE_PAYBACK_SEC = 30 * 60;

function nextUpgrade(
	state: GameState,
	content: GameContent,
): { id: string; cost: number } | null {
	let best: { id: string; cost: number; paybackSec: number } | null = null;
	for (const upgrade of content.upgrades) {
		const level = state.upgrades[upgrade.id] ?? 0;
		if (level >= upgrade.maxLevel) continue;
		const cost = upgradePrice(content, upgrade.id, level);
		const gain = upgradeGoldGainPerMinute(state, content, upgrade.id);
		if (gain <= 0) continue;
		const paybackSec = (cost / gain) * 60;
		if (paybackSec > MAX_UPGRADE_PAYBACK_SEC) continue;
		if (!best || paybackSec < best.paybackSec) {
			best = { id: upgrade.id, cost, paybackSec };
		}
	}
	return best ? { id: best.id, cost: best.cost } : null;
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
		const quest = questPlan(state, content);
		const gather = bestGather(state, content);

		const active = state.activeAction;
		if (active && active.kind === "gather" && gather) {
			const current = gatherGoldPerMinute(state, content, active.targetId);
			const questKeeps =
				quest !== null &&
				quest.kind === "gather" &&
				quest.targetId === active.targetId;
			const questTakesOver =
				quest !== null && quest.targetId !== active.targetId;
			const better =
				!questKeeps &&
				((plan ? plan.perMinute : 0) > current ||
					(fight ? fight.perMinute : 0) > current);
			if (better || questTakesOver) {
				const cancelled = cancelAction(state, now);
				if (cancelled.isOk()) state = cancelled.value;
			}
		}
		if (active && active.kind === "craft") {
			const recipe = content.recipes.find(
				(candidate) => candidate.id === active.targetId,
			);
			const stuck =
				!recipe ||
				recipe.inputs.some(
					(input) => (state.inventory[input.item] ?? 0) < input.qty,
				);
			if (stuck) {
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
					quest,
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
		const leveling = quest !== null && quest.leveling;
		if (preview.points > 0 && !leveling && quest === null) {
			const goldBefore = state.wallet.gold;
			const result = prestige(state, content, now);
			if (result.isOk()) {
				state = result.value;
				spent += goldBefore;
				prestigeRuns += 1;
				if (timeToPrestigeSec === null) timeToPrestigeSec = elapsedSec;
			}
		}

		state = tick(state, { content, now });

		const keepNeeds = new Map<string, number>();
		const keepRecipe = (
			recipeId: string | null | undefined,
			depth = 0,
		): void => {
			if (!recipeId || depth > 2) return;
			const recipe = content.recipes.find(
				(candidate) => candidate.id === recipeId,
			);
			if (!recipe) return;
			for (const input of recipe.inputs) {
				keepNeeds.set(
					input.item,
					(keepNeeds.get(input.item) ?? 0) + input.qty * 2,
				);
				for (const producer of content.recipes) {
					if (producer.output.item !== input.item) continue;
					keepRecipe(producer.id, depth + 1);
				}
			}
		};
		keepRecipe(plan?.recipeId);
		keepRecipe(quest?.keepRecipeId);
		keepRecipe(quest && quest.kind === "craft" ? quest.targetId : null);
		if (quest && quest.leveling && quest.skill) {
			keepRecipe(goalRecipeForSkill(state, content, quest.skill));
		}

		for (const item of content.items) {
			if (item.sellPrice <= 0) continue;
			const qty = state.inventory[item.id] ?? 0;
			if (qty <= 0) continue;
			const keep = keepNeeds.get(item.id) ?? 0;
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
	quest: QuestPlan | null;
	plan: { recipeId: string; gain: number; perMinute: number } | null;
	gather: { itemId: string; perMinute: number } | null;
};

function questCommand(
	content: GameContent,
	quest: QuestPlan,
): StartActionCommand {
	if (quest.kind === "fight") {
		return { kind: "fight", monsterId: quest.targetId };
	}
	if (quest.kind === "craft") {
		return { kind: "craft", recipeId: quest.targetId };
	}
	return {
		kind: "gather",
		skill: skillOf(content, quest.targetId) ?? "chopping",
		targetId: quest.targetId,
	};
}

function tryStart(
	state: GameState,
	content: GameContent,
	command: StartActionCommand,
	now: number,
): GameState | null {
	const result = startAction(state, content, command, now);
	return result.isOk() ? result.value : null;
}

function startBestAction(
	state: GameState,
	content: GameContent,
	choices: ActionChoices,
	now: number,
): GameState | null {
	const quest = choices.quest;
	if (quest) {
		const started = tryStart(state, content, questCommand(content, quest), now);
		if (started) return started;
	}

	const candidates: Array<{
		perMinute: number;
		run: () => GameState | null;
	}> = [];
	if (choices.plan) {
		const recipeId = choices.plan.recipeId;
		candidates.push({
			perMinute: choices.plan.perMinute,
			run: () => tryStart(state, content, { kind: "craft", recipeId }, now),
		});
	}
	if (choices.fight) {
		const monsterId = choices.fight.monsterId;
		candidates.push({
			perMinute: choices.fight.perMinute,
			run: () => tryStart(state, content, { kind: "fight", monsterId }, now),
		});
	}
	if (choices.gather) {
		const itemId = choices.gather.itemId;
		candidates.push({
			perMinute: choices.gather.perMinute,
			run: () =>
				tryStart(
					state,
					content,
					{
						kind: "gather",
						skill: skillOf(content, itemId) ?? "chopping",
						targetId: itemId,
					},
					now,
				),
		});
	}
	candidates.sort((a, b) => b.perMinute - a.perMinute);
	for (const candidate of candidates) {
		const started = candidate.run();
		if (started) return started;
	}

	return null;
}
