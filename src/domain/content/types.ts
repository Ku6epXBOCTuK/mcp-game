import type { ItemType, SkillId } from "../game/types.ts";

export type { ItemType };

export type SkillContent = {
	id: SkillId;
	name: string;
	description: string;
	xpCurve: { base: number; exponent: number };
	unlockLevel: number;
	icon: string;
};

export type ItemContent = {
	id: string;
	name: string;
	type: ItemType;
	skill?: SkillId | undefined;
	skillLevel?: number | undefined;
	sellPrice: number;
	buyPrice: number;
	description?: string | undefined;
};

export type RecipeContent = {
	id: string;
	output: { item: string; qty: number };
	inputs: { item: string; qty: number }[];
	skill: SkillId;
	skillLevel: number;
	timeSec: number;
};

export type UpgradeEffect =
	| {
			kind: "productionMultiplier";
			skill?: SkillId | undefined;
			valuePerLevel: number;
	  }
	| { kind: "passiveIncome"; valuePerLevel: number }
	| { kind: "xpMultiplier"; skill?: SkillId | undefined; valuePerLevel: number }
	| { kind: "unlock"; feature: string };

export type UpgradeContent = {
	id: string;
	name: string;
	maxLevel: number;
	costBase: number;
	costGrowth: number;
	effect: UpgradeEffect;
};

export type DropContent = {
	item: string;
	chance: number;
	qty: number;
};

export type MonsterContent = {
	id: string;
	name: string;
	zone: string;
	hp: number;
	damage: number;
	attackInterval: number;
	xp: number;
	dropTable: DropContent[];
};

export type ZoneUnlock =
	| { kind: "quest"; quest: string }
	| { kind: "skillLevel"; skill: SkillId; level: number }
	| { kind: "none" };

export type ZoneContent = {
	id: string;
	name: string;
	unlock: ZoneUnlock;
	monsters: string[];
};

export type QuestStep = {
	kind: "collect" | "craft" | "kill" | "level" | "upgrade";
	target: string;
	qty: number;
};

export type QuestReward = {
	kind: "item" | "skillLevel" | "upgrade" | "gold";
	id: string;
	qty: number;
};

export type QuestContent = {
	id: string;
	name: string;
	description?: string | undefined;
	steps: QuestStep[];
	rewards: QuestReward[];
};

export type EventModifier = {
	kind:
		"productionMultiplier" | "goldMultiplier" | "xpMultiplier" | "skillLevel";
	target?: string | undefined;
	value: number;
};

export type EventContent = {
	id: string;
	name: string;
	durationSec: number;
	modifiers: EventModifier[];
	weight: number;
};

export type BalanceContent = {
	upgradeCostScale?: Record<string, number> | undefined;
	prestigeGoldThreshold?: number | undefined;
	bankCreditLimitPerLevel?: number | undefined;
	bankInterestPerHour?: number | undefined;
	bankRepayShareOfIncome?: number | undefined;
	skillRateK: number;
	xpBase: number;
	xpExponent: number;
	tradingDiscountPerLevel: number;
	tradingDiscountMax: number;
	tradingXpPerGold?: number | undefined;
	marketDriftRange: number;
	marketDriftIntervalSec: number;
	marketReversion?: number | undefined;
	maxTickSec: number;
	maxTickPerDaySec: number;
	offlineCapSec: number;
	rateBase: Record<string, number>;
	xpPerSecond?: number | undefined;
	costGrowth: Record<string, number>;
	prestigeProductionExponent: number;
	prestigeGoldExponent: number;
	eventChancePerMinute: number;
	playerMaxHp: number;
	playerMaxHpPerCombatLevel?: number | undefined;
	playerHealthRegenPerSec?: number | undefined;
	potionHealthHealPercent?: number | undefined;
	playerDamageBase: number;
	playerDamagePerLevel: number;
	potionStrengthDamageMultiplier?: number | undefined;
	elixirDamageMultiplier?: number | undefined;
	travelTimeSec?: number | undefined;
};

export type GameContent = {
	skills: SkillContent[];
	items: ItemContent[];
	recipes: RecipeContent[];
	upgrades: UpgradeContent[];
	monsters: MonsterContent[];
	zones: ZoneContent[];
	quests: QuestContent[];
	events: EventContent[];
	balance: BalanceContent;
};
