import {
  SKILL_IDS,
  type GameState,
  type Inventory,
  type PlayerId,
  type QuestsState,
  type RngState,
  type SkillId,
  type SkillState,
  type UpgradeLevels,
} from "./types.ts";

export const STATE_VERSION = 3;

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
    activeEvents: [],
    health: { hp: 100, maxHp: 100 },
    upgrades: {},
    prestige: { points: 0, layers: 0, runs: 0, multipliers: {} },
    quests: {},
    market: { seed, counter: 0, prices: {}, updatedAt: now },
    bank: { deposits: 0, credit: 0, accruedAt: now },
    counters: { gathered: {}, crafted: {}, killed: {} },
    stats: { totalGoldEarned: 0 },
    rng: { seed, counter: 0 },
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

export function withQuests(
  state: GameState,
  quests: QuestsState,
): GameState {
  return { ...state, quests };
}

export function withRng(
  state: GameState,
  rng: RngState,
): GameState {
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

export function touch(
  state: GameState,
  now: number,
): GameState {
  return { ...state, updatedAt: now };
}
