import {
	SKILL_IDS,
	type ActiveAction,
	type CombatBuff,
	type CombatPolicy,
	type GameState,
	type Inventory,
	type PlayerId,
	type QuestsState,
	type RngState,
	type SkillId,
	type SkillState,
	type UpgradeLevels,
} from "./types.ts";
import { DEFAULT_COMBAT_POLICY, startCombat } from "./combat.ts";
import type { GameContent } from "../content/types.ts";

export const STATE_VERSION = 8;

const EVENT_RNG_SALT = 0x9e3779b9;

export function migrateState(
	state: GameState,
	content: GameContent,
): GameState {
	if (state.version >= STATE_VERSION) return state;
	const legacyStats = state.stats as {
		totalGoldEarned: number;
		deaths?: number;
	};
	const legacyPolicy = (state as { combatPolicy?: CombatPolicy }).combatPolicy;
	const legacyEventRng = (state as { eventRng?: RngState }).eventRng;
	const legacyBuffs = (state as { combatBuffs?: CombatBuff[] }).combatBuffs;
	const legacyPaused = (state as { pausedActions?: ActiveAction[] })
		.pausedActions;
	const legacyCounters = state.counters as {
		gathered: Record<string, number>;
		crafted: Record<string, number>;
		craftedItems?: Record<string, number>;
		killed: Record<string, number>;
	};
	let next: GameState = {
		...state,
		version: STATE_VERSION,
		stats: {
			totalGoldEarned: legacyStats.totalGoldEarned,
			deaths: legacyStats.deaths ?? 0,
		},
		combatPolicy: {
			...DEFAULT_COMBAT_POLICY,
			...(legacyPolicy ?? {}),
			strengthPotionWhenLosing: legacyPolicy?.strengthPotionWhenLosing ?? false,
		},
		combatBuffs: legacyBuffs ?? [],
		pausedActions: legacyPaused ?? [],
		eventRng: legacyEventRng ?? {
			seed: ((state.rng?.seed ?? 0) ^ EVENT_RNG_SALT) >>> 0,
			counter: 0,
		},
		counters: {
			gathered: legacyCounters.gathered ?? {},
			crafted: legacyCounters.crafted ?? {},
			craftedItems: legacyCounters.craftedItems ?? {},
			killed: legacyCounters.killed ?? {},
		},
	};
	const action = next.activeAction;
	if (action && action.kind === "fight") {
		const legacyProgress =
			(action as unknown as { progress?: number }).progress ?? 0;
		const monster = content.monsters.find(
			(entry) => entry.id === action.targetId,
		);
		next = {
			...next,
			activeAction: {
				kind: "fight",
				skill: "combat",
				targetId: action.targetId,
				startedAt: action.startedAt,
				endsAt: action.endsAt,
				monsterHpLeft: Math.max(0, (monster?.hp ?? 0) - legacyProgress),
				monsterHitInSec: monster ? startCombat(monster).monsterHitInSec : 1,
				damageMultiplier: action.damageMultiplier ?? 1,
			},
		};
	}
	return next;
}

export function createInitialState(
	playerId: PlayerId,
	seed: number,
	now: number,
): GameState {
	return {
		version: STATE_VERSION,
		playerId,
		createdAt: now,
		updatedAt: now,
		lastTickAt: now,
		wallet: { gold: 0, credits: 0 },
		inventory: {},
		skills: createSkills(),
		activeAction: null,
		pausedActions: [],
		activeEvents: [],
		health: { hp: 100, maxHp: 100 },
		upgrades: {},
		prestige: { points: 0, layers: 0, runs: 0, multipliers: {} },
		quests: {},
		market: { seed, counter: 0, prices: {}, updatedAt: now },
		bank: { deposits: 0, credit: 0, accruedAt: now },
		counters: { gathered: {}, crafted: {}, craftedItems: {}, killed: {} },
		stats: { totalGoldEarned: 0, deaths: 0 },
		combatPolicy: { ...DEFAULT_COMBAT_POLICY },
		combatBuffs: [],
		rng: { seed, counter: 0 },
		eventRng: { seed: (seed ^ EVENT_RNG_SALT) >>> 0, counter: 0 },
	};
}

export function createSkills(): Record<SkillId, SkillState> {
	const skills = {} as Record<SkillId, SkillState>;
	for (const id of SKILL_IDS) {
		skills[id] = { id, level: 1, xp: 0 };
	}
	return skills;
}

export function withWallet(
	state: GameState,
	patch: Partial<GameState["wallet"]>,
): GameState {
	return { ...state, wallet: { ...state.wallet, ...patch } };
}

export function withInventory(
	state: GameState,
	itemId: string,
	qty: number,
): GameState {
	const inventory: Inventory = { ...state.inventory };
	const next = (inventory[itemId] ?? 0) + qty;
	if (next <= 0) delete inventory[itemId];
	else inventory[itemId] = next;
	return { ...state, inventory };
}

export function withUpgrade(
	state: GameState,
	upgradeId: string,
	level: number,
): GameState {
	const upgrades: UpgradeLevels = { ...state.upgrades, [upgradeId]: level };
	return { ...state, upgrades };
}

export function withQuests(state: GameState, quests: QuestsState): GameState {
	return { ...state, quests };
}

export function withRng(state: GameState, rng: RngState): GameState {
	return { ...state, rng };
}

export function withSkill(
	state: GameState,
	skillId: SkillId,
	patch: Partial<Omit<SkillState, "id">>,
): GameState {
	const current = state.skills[skillId];
	if (!current) return state;
	return {
		...state,
		skills: { ...state.skills, [skillId]: { ...current, ...patch } },
	};
}

export function touch(state: GameState, now: number): GameState {
	return { ...state, updatedAt: now };
}
