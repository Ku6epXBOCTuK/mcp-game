export type PlayerId = string;

export const SKILL_IDS = [
  "chopping",
  "mining",
  "hunting",
  "crafting",
  "cooking",
  "trading",
  "combat",
  "magic",
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

export type ItemType = "resource" | "material" | "food" | "tool" | "quest";

export type ItemId = string;
export type RecipeId = string;
export type UpgradeId = string;
export type ZoneId = string;
export type MonsterId = string;
export type QuestId = string;
export type EventId = string;

export type Wallet = {
  gold: number;
  credits: number;
};

export type Inventory = Record<ItemId, number>;

export type SkillState = {
  id: SkillId;
  level: number;
  xp: number;
};

export type ActiveActionKind = "gather" | "craft" | "fight";

export type ActiveAction = {
  kind: ActiveActionKind;
  skill: SkillId;
  targetId: string;
  startedAt: number;
  endsAt: number;
  progress: number;
};

export type UpgradeLevels = Record<UpgradeId, number>;

export type PrestigeState = {
  points: number;
  layers: number;
  runs: number;
  multipliers: Record<string, number>;
};

export type QuestStatus = "locked" | "available" | "in-progress" | "completed" | "claimed";

export type QuestState = {
  id: QuestId;
  status: QuestStatus;
  progress: number;
};

export type QuestsState = Record<QuestId, QuestState>;

import type { RngState } from "../shared/rng.ts";

export type { RngState };

export type ActiveEvent = {
  id: EventId;
  startedAt: number;
  endsAt: number;
};

export type Health = {
  hp: number;
  maxHp: number;
};

export type MarketState = {
  seed: number;
  counter: number;
  prices: Record<ItemId, number>;
  updatedAt: number;
};

export type BankState = {
  deposits: number;
  credit: number;
  accruedAt: number;
};

export type GameCounters = {
  gathered: Record<ItemId, number>;
  crafted: Record<RecipeId, number>;
  killed: Record<MonsterId, number>;
};

export type GameStats = {
  totalGoldEarned: number;
};

export type GameState = {
  version: number;
  playerId: PlayerId;
  createdAt: number;
  updatedAt: number;
  lastTickAt: number;
  wallet: Wallet;
  inventory: Inventory;
  skills: Record<SkillId, SkillState>;
  activeAction: ActiveAction | null;
  activeEvents: ActiveEvent[];
  health: Health;
  upgrades: UpgradeLevels;
  prestige: PrestigeState;
  quests: QuestsState;
  market: MarketState;
  bank: BankState;
  counters: GameCounters;
  stats: GameStats;
  rng: RngState;
};

export type GameEvent = {
  ts: number;
  type: string;
  payload: Record<string, unknown>;
};
