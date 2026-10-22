import { productionRate } from "../shared/curves.ts";
import { nextRandom } from "../shared/rng.ts";
import { refreshMarket } from "./market.ts";
import { accrueInterest, applyGoldIncome } from "./bank.ts";
import {
	eventMultipliers,
	upgradeMultiplier,
	type Multipliers,
} from "./multipliers.ts";
import { gainXp } from "./skills.ts";
import {
	consumePotions,
	maxHpFor,
	potionHealAmount,
	regenerateHealth,
} from "./health.ts";
import { advanceCombat, DEFAULT_COMBAT_POLICY } from "./combat.ts";
import type { GameContent, EventContent } from "../content/types.ts";
import type {
	ActiveEvent,
	CraftAction,
	FightAction,
	GatherAction,
	GameState,
	SkillId,
} from "./types.ts";

export type TickOptions = {
	content: GameContent;
	now: number;
};

function skillLevelOf(state: GameState, skill: SkillId, bonus: number): number {
	const current = state.skills[skill];
	return (current?.level ?? 1) + bonus;
}

function passiveIncomePerSec(state: GameState, content: GameContent): number {
	let income = 0;
	for (const upgrade of content.upgrades) {
		if (upgrade.effect.kind !== "passiveIncome") continue;
		const level = state.upgrades[upgrade.id] ?? 0;
		if (level <= 0) continue;
		income += upgrade.effect.valuePerLevel * level;
	}
	return income;
}

function addItem(state: GameState, itemId: string, qty: number): GameState {
	if (qty <= 0) return state;
	const inventory = { ...state.inventory };
	inventory[itemId] = (inventory[itemId] ?? 0) + qty;
	return { ...state, inventory };
}

function rollDrops(
	state: GameState,
	monster: GameContent["monsters"][number],
	random: () => number,
): GameState {
	let next = state;
	for (const drop of monster.dropTable) {
		if (random() < drop.chance) {
			next = addItem(next, drop.item, drop.qty);
		}
	}
	return next;
}

function spawnEvent(
	content: GameContent,
	random: () => number,
): { event: EventContent | null } {
	const candidates = content.events.filter((event) => event.weight > 0);
	if (candidates.length === 0) return { event: null };
	const total = candidates.reduce((sum, event) => sum + event.weight, 0);
	let roll = random() * total;
	for (const event of candidates) {
		roll -= event.weight;
		if (roll < 0) return { event };
	}
	return { event: candidates[candidates.length - 1] ?? null };
}

function applyGather(
	state: GameState,
	action: GatherAction,
	elapsed: number,
	content: GameContent,
	multipliers: Multipliers,
): GameState {
	const balance = content.balance;
	const skill = action.skill;
	const level = skillLevelOf(state, skill, multipliers.skillBonus[skill] ?? 0);
	const rateBase = balance.rateBase[skill] ?? 0;
	const rate = productionRate({
		rateBase,
		skillLevel: level,
		upgradeMult:
			upgradeMultiplier(state, content, "productionMultiplier", skill) *
			multipliers.production,
		prestigeMult: Math.pow(
			state.prestige.points + 1,
			balance.prestigeProductionExponent,
		),
		k: balance.skillRateK,
	});
	const before = action.progress;
	const after = before + (rate * elapsed) / 60;
	const produced = Math.floor(after) - Math.floor(before);
	let next = state;
	if (produced > 0) {
		next = addItem(next, action.targetId, produced);
		next = {
			...next,
			counters: {
				...next.counters,
				gathered: {
					...next.counters.gathered,
					[action.targetId]:
						(next.counters.gathered[action.targetId] ?? 0) + produced,
				},
			},
		};
	}
	next = gainXp(
		next,
		skill,
		elapsed *
			(balance.xpPerSecond ?? 1) *
			multipliers.xp *
			upgradeMultiplier(next, content, "xpMultiplier", skill),
		balance.xpBase,
		balance.xpExponent,
	);
	return {
		...next,
		activeAction: { ...action, progress: after },
	};
}

function maxCraftsByInputs(
	state: GameState,
	inputs: { item: string; qty: number }[],
): number {
	if (inputs.length === 0) return Number.POSITIVE_INFINITY;
	let limit = Number.POSITIVE_INFINITY;
	for (const input of inputs) {
		const available = state.inventory[input.item] ?? 0;
		limit = Math.min(limit, Math.floor(available / input.qty));
	}
	return Number.isFinite(limit) ? limit : 0;
}

function consumeInputs(
	state: GameState,
	recipe: GameContent["recipes"][number],
	count: number,
): GameState {
	const inventory = { ...state.inventory };
	for (const input of recipe.inputs) {
		const left = (inventory[input.item] ?? 0) - input.qty * count;
		if (left <= 0) delete inventory[input.item];
		else inventory[input.item] = left;
	}
	return { ...state, inventory };
}

function applyCraft(
	state: GameState,
	action: CraftAction,
	elapsed: number,
	content: GameContent,
	multipliers: Multipliers,
): GameState {
	const balance = content.balance;
	const recipe = content.recipes.find((entry) => entry.id === action.targetId);
	if (!recipe) return { ...state, activeAction: null };
	const level = skillLevelOf(
		state,
		recipe.skill,
		multipliers.skillBonus[recipe.skill] ?? 0,
	);
	const speed = productionRate({
		rateBase: 1,
		skillLevel: level,
		upgradeMult:
			upgradeMultiplier(state, content, "productionMultiplier", recipe.skill) *
			multipliers.production,
		prestigeMult: Math.pow(
			state.prestige.points + 1,
			balance.prestigeProductionExponent,
		),
		k: balance.skillRateK,
	});
	const before = action.progress;
	const after = before + elapsed * speed;
	const rawProduced =
		Math.floor(after / recipe.timeSec) - Math.floor(before / recipe.timeSec);
	const affordable = maxCraftsByInputs(state, recipe.inputs);
	const produced = Math.min(rawProduced, affordable);
	let next = state;
	if (produced > 0) {
		next = consumeInputs(next, recipe, produced);
		next = addItem(next, recipe.output.item, produced * recipe.output.qty);
		next = {
			...next,
			counters: {
				...next.counters,
				crafted: {
					...next.counters.crafted,
					[recipe.id]: (next.counters.crafted[recipe.id] ?? 0) + produced,
				},
				craftedItems: {
					...next.counters.craftedItems,
					[recipe.output.item]:
						(next.counters.craftedItems[recipe.output.item] ?? 0) +
						produced * recipe.output.qty,
				},
			},
		};
	}
	next = gainXp(
		next,
		recipe.skill,
		elapsed *
			(balance.xpPerSecond ?? 1) *
			multipliers.xp *
			upgradeMultiplier(next, content, "xpMultiplier", recipe.skill),
		balance.xpBase,
		balance.xpExponent,
	);
	return {
		...next,
		activeAction: { ...action, progress: after },
	};
}

function applyFight(
	state: GameState,
	action: FightAction,
	elapsed: number,
	content: GameContent,
	multipliers: Multipliers,
	random: () => number,
	now: number,
): { state: GameState; idleSec: number } {
	const balance = content.balance;
	const monster = content.monsters.find(
		(entry) => entry.id === action.targetId,
	);
	if (!monster) {
		return { state: { ...state, activeAction: null }, idleSec: elapsed };
	}
	const combatLevel = skillLevelOf(
		state,
		"combat",
		multipliers.skillBonus.combat ?? 0,
	);
	const maxHp = maxHpFor(state, content);
	const dps =
		balance.playerDamageBase + balance.playerDamagePerLevel * combatLevel;
	const policy = state.combatPolicy ?? DEFAULT_COMBAT_POLICY;
	const potionHeal = potionHealAmount(content, maxHp);

	let current = state;
	let fight: FightAction = action;
	let remaining = elapsed;
	let idleSec = 0;
	let nextAction: FightAction | null = null;

	while (remaining > 0) {
		const result = advanceCombat({
			combat: {
				monsterHpLeft: fight.monsterHpLeft,
				monsterHitInSec: fight.monsterHitInSec,
			},
			elapsed: remaining,
			monster,
			playerDps: dps,
			playerHp: current.health.hp,
			playerMaxHp: maxHp,
			potionHeal,
			potionsAvailable: current.inventory.potion_health ?? 0,
			policy,
		});
		if (result.potionsUsed > 0) {
			current = consumePotions(current, result.potionsUsed);
		}
		remaining -= result.spentSec;
		current = { ...current, health: { hp: result.playerHp, maxHp } };

		if (result.outcome === "ongoing") {
			nextAction = {
				...fight,
				monsterHpLeft: result.combat.monsterHpLeft,
				monsterHitInSec: result.combat.monsterHitInSec,
			};
			break;
		}

		if (result.outcome === "victory") {
			current = grantKill(current, monster, multipliers, random, content);
			if (policy.autoRepeat) {
				fight = {
					...fight,
					startedAt: now,
					monsterHpLeft: monster.hp,
					monsterHitInSec:
						monster.attackInterval > 0 ? monster.attackInterval : Infinity,
				};
				nextAction = fight;
				if (remaining > 0) continue;
				break;
			}
			nextAction = null;
			idleSec += remaining;
			break;
		}

		if (result.outcome === "defeat") {
			current = {
				...current,
				health: { hp: maxHp, maxHp },
				stats: { ...current.stats, deaths: current.stats.deaths + 1 },
			};
			nextAction = null;
			idleSec += remaining;
			break;
		}

		nextAction = null;
		idleSec += remaining;
		break;
	}

	return { state: { ...current, activeAction: nextAction }, idleSec };
}

function grantKill(
	state: GameState,
	monster: GameContent["monsters"][number],
	multipliers: Multipliers,
	random: () => number,
	content: GameContent,
): GameState {
	const balance = content.balance;
	let next: GameState = {
		...state,
		health: { hp: state.health.hp, maxHp: state.health.maxHp },
	};
	next = gainXp(
		next,
		"combat",
		monster.xp *
			multipliers.xp *
			upgradeMultiplier(next, content, "xpMultiplier", "combat"),
		balance.xpBase,
		balance.xpExponent,
	);
	next = rollDrops(next, monster, random);
	next = {
		...next,
		counters: {
			...next.counters,
			killed: {
				...next.counters.killed,
				[monster.id]: (next.counters.killed[monster.id] ?? 0) + 1,
			},
		},
	};
	return next;
}

export function tick(state: GameState, options: TickOptions): GameState {
	const { content, now } = options;
	const balance = content.balance;
	const rawElapsed = now - state.lastTickAt;
	if (rawElapsed <= 0) return state;
	const elapsed = Math.min(rawElapsed, balance.offlineCapSec);

	let rngState = state.rng;
	const random = (): number => {
		const result = nextRandom(rngState);
		rngState = result.state;
		return result.value;
	};

	// NOTE: the event stream is separate so that per-tick event rolls cannot
	// shift the loot rolls: loot must not depend on the poll interval.
	let eventRngState = state.eventRng ?? state.rng;
	const eventRandom = (): number => {
		const result = nextRandom(eventRngState);
		eventRngState = result.state;
		return result.value;
	};

	const activeEvents = state.activeEvents.filter((event) => event.endsAt > now);
	let next: GameState = {
		...state,
		activeEvents,
		rng: rngState,
		eventRng: eventRngState,
	};

	const multipliers = eventMultipliers(next, content);

	const action = next.activeAction;
	let idleSec = elapsed;
	if (action) {
		if (action.kind === "gather") {
			next = applyGather(next, action, elapsed, content, multipliers);
		} else if (action.kind === "craft") {
			next = applyCraft(next, action, elapsed, content, multipliers);
		} else {
			const result = applyFight(
				next,
				action,
				elapsed,
				content,
				multipliers,
				random,
				now,
			);
			next = result.state;
			idleSec = result.idleSec;
		}
	}

	next = accrueInterest(next, content, elapsed);
	next = regenerateHealth(next, content, idleSec);

	const income = passiveIncomePerSec(next, content);
	if (income > 0) {
		const prestigeGold = Math.pow(
			next.prestige.points + 1,
			balance.prestigeGoldExponent,
		);
		const gold = income * elapsed * multipliers.gold * prestigeGold;
		next = applyGoldIncome(next, content, gold);
	}

	const minutes = elapsed / 60;
	const chance = Math.min(1, balance.eventChancePerMinute * minutes);
	if (eventRandom() < chance) {
		const spawned = spawnEvent(content, eventRandom);
		if (spawned.event) {
			const active: ActiveEvent = {
				id: spawned.event.id,
				startedAt: now,
				endsAt: now + spawned.event.durationSec,
			};
			next = { ...next, activeEvents: [...next.activeEvents, active] };
		}
	}

	const withMarket = refreshMarket(next, content, now);

	return {
		...withMarket,
		rng: rngState,
		eventRng: eventRngState,
		lastTickAt: now,
		updatedAt: now,
	};
}
