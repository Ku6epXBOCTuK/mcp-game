import { z } from "zod";
import { SKILL_IDS, type SkillId } from "../../domain/game/types.ts";
import type {
	BalanceContent,
	EventContent,
	GameContent,
	ItemContent,
	MonsterContent,
	QuestContent,
	RecipeContent,
	SkillContent,
	UpgradeContent,
	ZoneContent,
} from "../../domain/content/types.ts";

export const skillIdSchema = z.enum(SKILL_IDS);
export const itemIdSchema = z.string().min(1);

export const itemTypeSchema = z.enum([
	"resource",
	"material",
	"food",
	"tool",
	"quest",
]);

export const skillSchema = z.object({
	id: skillIdSchema,
	name: z.string().min(1),
	description: z.string(),
	xpCurve: z.object({
		base: z.number().positive(),
		exponent: z.number().positive(),
	}),
	unlockLevel: z.number().int().min(1),
	icon: z.string().min(1),
}) satisfies z.ZodType<SkillContent>;

export const itemSchema = z.object({
	id: itemIdSchema,
	name: z.string().min(1),
	type: itemTypeSchema,
	skill: skillIdSchema.optional(),
	skillLevel: z.number().int().min(1).optional(),
	sellPrice: z.number().nonnegative(),
	buyPrice: z.number().nonnegative(),
	description: z.string().optional(),
}) satisfies z.ZodType<ItemContent>;

export const recipeSchema = z.object({
	id: z.string().min(1),
	output: z.object({
		item: itemIdSchema,
		qty: z.number().positive(),
	}),
	inputs: z.array(
		z.object({
			item: itemIdSchema,
			qty: z.number().positive(),
		}),
	),
	skill: skillIdSchema,
	skillLevel: z.number().int().min(1),
	timeSec: z.number().positive(),
}) satisfies z.ZodType<RecipeContent>;

export const upgradeEffectSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("productionMultiplier"),
		skill: skillIdSchema.optional(),
		valuePerLevel: z.number().min(0),
	}),
	z.object({
		kind: z.literal("passiveIncome"),
		valuePerLevel: z.number().min(0),
	}),
	z.object({
		kind: z.literal("xpMultiplier"),
		skill: skillIdSchema.optional(),
		valuePerLevel: z.number().min(0),
	}),
	z.object({
		kind: z.literal("unlock"),
		feature: z.string().min(1),
	}),
]);

export const upgradeSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	maxLevel: z.number().int().min(1),
	costBase: z.number().positive(),
	costGrowth: z.number().min(1),
	effect: upgradeEffectSchema,
});

export const dropSchema = z.object({
	item: itemIdSchema,
	chance: z.number().min(0).max(1),
	qty: z.number().int().min(1),
});

export const monsterSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	zone: z.string().min(1),
	hp: z.number().positive(),
	damage: z.number().positive(),
	attackInterval: z.number().positive(),
	xp: z.number().nonnegative(),
	dropTable: z.array(dropSchema).min(1),
}) satisfies z.ZodType<MonsterContent>;

export const zoneUnlockSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("quest"),
		quest: z.string().min(1),
	}),
	z.object({
		kind: z.literal("skillLevel"),
		skill: skillIdSchema,
		level: z.number().int().min(1),
	}),
	z.object({
		kind: z.literal("none"),
	}),
]);

export const zoneSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	unlock: zoneUnlockSchema,
	monsters: z.array(z.string().min(1)).min(1),
}) satisfies z.ZodType<ZoneContent>;

export const questStepSchema = z.object({
	kind: z.enum(["collect", "craft", "kill", "level", "upgrade"]),
	target: z.string().min(1),
	qty: z.number().int().min(1),
});

export const questRewardSchema = z.object({
	kind: z.enum(["item", "skillLevel", "upgrade", "gold"]),
	id: z.string().min(1),
	qty: z.number().int().min(1),
});

export const questSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string().optional(),
	steps: z.array(questStepSchema).min(1),
	rewards: z.array(questRewardSchema),
}) satisfies z.ZodType<QuestContent>;

export const eventModifierSchema = z.object({
	kind: z.enum([
		"productionMultiplier",
		"goldMultiplier",
		"xpMultiplier",
		"skillLevel",
	]),
	target: z.string().optional(),
	value: z.number(),
});

export const eventSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	durationSec: z.number().int().min(1),
	modifiers: z.array(eventModifierSchema).min(1),
	weight: z.number().positive(),
}) satisfies z.ZodType<EventContent>;

export const balanceSchema = z.object({
	upgradeCostScale: z.record(z.string(), z.number().positive()).optional(),
	prestigeGoldThreshold: z.number().positive().optional(),
	bankCreditLimitPerLevel: z.number().min(0).optional(),
	bankInterestPerHour: z.number().min(0).optional(),
	bankRepayShareOfIncome: z.number().min(0).max(1).optional(),
	skillRateK: z.number().min(0),
	xpBase: z.number().positive(),
	xpExponent: z.number().positive(),
	tradingDiscountPerLevel: z.number().min(0),
	tradingDiscountMax: z.number().min(0),
	tradingXpPerGold: z.number().min(0).optional(),
	marketDriftRange: z.number().min(0),
	marketDriftIntervalSec: z.number().int().min(1),
	marketReversion: z.number().min(0).max(1).optional(),
	maxTickSec: z.number().int().min(1),
	maxTickPerDaySec: z.number().int().min(1),
	offlineCapSec: z.number().int().min(1),
	rateBase: z.record(z.string(), z.number().positive()),
	xpPerSecond: z.number().min(0).optional(),
	costGrowth: z.record(z.string(), z.number().min(1)),
	prestigeProductionExponent: z.number().min(0),
	prestigeGoldExponent: z.number().min(0),
	eventChancePerMinute: z.number().min(0),
	playerMaxHp: z.number().int().positive(),
	playerMaxHpPerCombatLevel: z.number().min(0).optional(),
	playerHealthRegenPerSec: z.number().min(0).optional(),
	potionHealthHealPercent: z.number().min(0).max(1).optional(),
	playerDamageBase: z.number().min(0),
	playerDamagePerLevel: z.number().min(0),
	potionStrengthDamageMultiplier: z.number().min(1).optional(),
	elixirDamageMultiplier: z.number().min(1).optional(),
	travelTimeSec: z.number().min(0).optional(),
}) satisfies z.ZodType<BalanceContent>;

export const skillsFileSchema = z.array(skillSchema);
export const itemsFileSchema = z.array(itemSchema);
export const recipesFileSchema = z.array(recipeSchema);
export const upgradesFileSchema = z.array(upgradeSchema);
export const monstersFileSchema = z.array(monsterSchema);
export const zonesFileSchema = z.array(zoneSchema);
export const questsFileSchema = z.array(questSchema);
export const eventsFileSchema = z.array(eventSchema);

type AssertEqual<A, B> = [A] extends [B]
	? [B] extends [A]
		? true
		: false
	: false;

export type UpgradesSchemaMatchesDomain = AssertEqual<
	z.infer<typeof upgradesFileSchema>,
	UpgradeContent[]
>;
export type ContentSchemaMatchesDomain = AssertEqual<
	z.infer<typeof gameContentSchema>,
	GameContent
>;

export const gameContentSchema = z.object({
	skills: skillsFileSchema,
	items: itemsFileSchema,
	recipes: recipesFileSchema,
	upgrades: upgradesFileSchema,
	monsters: monstersFileSchema,
	zones: zonesFileSchema,
	quests: questsFileSchema,
	events: eventsFileSchema,
	balance: balanceSchema,
});

export type { SkillId };
