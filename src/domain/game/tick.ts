import { productionRate, xpToNext } from "../shared/curves.ts";
import { nextRandom } from "../shared/rng.ts";
import { refreshMarket } from "./market.ts";
import { accrueInterest, applyGoldIncome } from "./bank.ts";
import { maxHpFor, regenerateHealth } from "./health.ts";
import type { GameContent, EventContent } from "../content/types.ts";
import type { ActiveAction, ActiveEvent, GameState, SkillId } from "./types.ts";

export type TickOptions = {
	content: GameContent;
	now: number;
};

type Multipliers = {
	production: number;
	gold: number;
	xp: number;
	skillBonus: Partial<Record<SkillId, number>>;
};

function skillLevelOf(state: GameState, skill: SkillId, bonus: number): number {
	const current = state.skills[skill];
	return (current?.level ?? 1) + bonus;
}

function upgradeMultiplier(
	state: GameState,
	content: GameContent,
	kind: "productionMultiplier" | "xpMultiplier",
	skill: SkillId,
): number {
	let multiplier = 1;
	for (const upgrade of content.upgrades) {
		if (upgrade.effect.kind !== kind) continue;
		const level = state.upgrades[upgrade.id] ?? 0;
		if (level <= 0) continue;
		const target = upgrade.effect.skill;
		if (target && target !== skill) continue;
		multiplier += upgrade.effect.valuePerLevel * level;
	}
	return multiplier;
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

function eventMultipliers(state: GameState, content: GameContent): Multipliers {
	const multipliers: Multipliers = {
		production: 1,
		gold: 1,
		xp: 1,
		skillBonus: {},
	};
	const byId = new Map(content.events.map((event) => [event.id, event]));
	for (const active of state.activeEvents) {
		const event = byId.get(active.id);
		if (!event) continue;
		for (const modifier of event.modifiers) {
			switch (modifier.kind) {
				case "productionMultiplier":
					multipliers.production *= modifier.value;
					break;
				case "goldMultiplier":
					multipliers.gold *= modifier.value;
					break;
				case "xpMultiplier":
					multipliers.xp *= modifier.value;
					break;
				case "skillLevel": {
					const target = modifier.target as SkillId | undefined;
					if (target) {
						multipliers.skillBonus[target] =
							(multipliers.skillBonus[target] ?? 0) + modifier.value;
					}
					break;
				}
			}
		}
	}
	return multipliers;
}

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
	action: ActiveAction,
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
		next = gainXp(
			next,
			skill,
			produced *
				multipliers.xp *
				upgradeMultiplier(next, content, "xpMultiplier", skill),
			balance.xpBase,
			balance.xpExponent,
		);
	}
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
	action: ActiveAction,
	elapsed: number,
	content: GameContent,
	multipliers: Multipliers,
): GameState {
	const balance = content.balance;
	const recipe = content.recipes.find((entry) => entry.id === action.targetId);
	if (!recipe) return { ...state, activeAction: null };
	const before = action.progress;
	const after = before + elapsed;
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
			},
		};
		next = gainXp(
			next,
			recipe.skill,
			produced *
				multipliers.xp *
				upgradeMultiplier(next, content, "xpMultiplier", recipe.skill),
			balance.xpBase,
			balance.xpExponent,
		);
	}
	return {
		...next,
		activeAction: { ...action, progress: after },
	};
}

function applyFight(
	state: GameState,
	action: ActiveAction,
	elapsed: number,
	content: GameContent,
	multipliers: Multipliers,
	random: () => number,
): GameState {
	const balance = content.balance;
	const monster = content.monsters.find(
		(entry) => entry.id === action.targetId,
	);
	if (!monster) return { ...state, activeAction: null };
	const combatLevel = skillLevelOf(
		state,
		"combat",
		multipliers.skillBonus.combat ?? 0,
	);
	const maxHp = maxHpFor(state, content);
	const dps =
		balance.playerDamageBase + balance.playerDamagePerLevel * combatLevel;
	const dealtBefore = action.progress;
	const dealtAfter = dealtBefore + dps * elapsed;
	const monsterHpLeft = monster.hp - dealtAfter;

	const hits = Math.floor(elapsed / monster.attackInterval);
	const taken = hits * monster.damage;
	const health = Math.max(0, state.health.hp - taken);

	if (health <= 0) {
		return {
			...state,
			health: { hp: maxHp, maxHp },
			activeAction: null,
		};
	}

	if (monsterHpLeft <= 0) {
		let next: GameState = {
			...state,
			health: { hp: health, maxHp: state.health.maxHp },
			activeAction: null,
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

	return {
		...state,
		health: { hp: health, maxHp: state.health.maxHp },
		activeAction: { ...action, progress: dealtAfter },
	};
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

	const activeEvents = state.activeEvents.filter((event) => event.endsAt > now);
	let next: GameState = { ...state, activeEvents, rng: rngState };

	const multipliers = eventMultipliers(next, content);

	const action = next.activeAction;
	if (action) {
		if (action.kind === "gather") {
			next = applyGather(next, action, elapsed, content, multipliers);
		} else if (action.kind === "craft") {
			next = applyCraft(next, action, elapsed, content, multipliers);
		} else {
			next = applyFight(next, action, elapsed, content, multipliers, random);
		}
	}

	next = accrueInterest(next, content, elapsed);
	next = regenerateHealth(next, content, elapsed);

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
	if (random() < chance) {
		const spawned = spawnEvent(content, random);
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
		lastTickAt: now,
		updatedAt: now,
	};
}
