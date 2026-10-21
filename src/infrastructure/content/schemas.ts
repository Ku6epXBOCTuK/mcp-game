import { z } from "zod";

export const skillIdSchema = z.string().min(1);
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
});
export type SkillContent = z.infer<typeof skillSchema>;

export const itemSchema = z.object({
  id: itemIdSchema,
  name: z.string().min(1),
  type: itemTypeSchema,
  sellPrice: z.number().nonnegative(),
  buyPrice: z.number().nonnegative(),
  description: z.string().optional(),
});
export type ItemContent = z.infer<typeof itemSchema>;

export const recipeSchema = z.object({
  id: z.string().min(1),
  output: z.object({
    item: itemIdSchema,
    qty: z.number().positive(),
  }),
  inputs: z
    .array(
      z.object({
        item: itemIdSchema,
        qty: z.number().positive(),
      }),
    )
    .min(1),
  skill: skillIdSchema,
  skillLevel: z.number().int().min(1),
  timeSec: z.number().positive(),
});
export type RecipeContent = z.infer<typeof recipeSchema>;

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
export type UpgradeEffect = z.infer<typeof upgradeEffectSchema>;

export const upgradeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  maxLevel: z.number().int().min(1),
  costBase: z.number().positive(),
  costGrowth: z.number().min(1),
  effect: upgradeEffectSchema,
});
export type UpgradeContent = z.infer<typeof upgradeSchema>;

export const dropSchema = z.object({
  item: itemIdSchema,
  chance: z.number().min(0).max(1),
  qty: z.number().int().min(1),
});
export type DropContent = z.infer<typeof dropSchema>;

export const monsterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  zone: z.string().min(1),
  hp: z.number().positive(),
  damage: z.number().positive(),
  attackInterval: z.number().positive(),
  xp: z.number().nonnegative(),
  dropTable: z.array(dropSchema).min(1),
});
export type MonsterContent = z.infer<typeof monsterSchema>;

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
export type ZoneUnlock = z.infer<typeof zoneUnlockSchema>;

export const zoneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  unlock: zoneUnlockSchema,
  monsters: z.array(z.string().min(1)).min(1),
});
export type ZoneContent = z.infer<typeof zoneSchema>;

export const questStepSchema = z.object({
  kind: z.enum(["collect", "craft", "kill", "level", "upgrade"]),
  target: z.string().min(1),
  qty: z.number().int().min(1),
});
export type QuestStep = z.infer<typeof questStepSchema>;

export const questRewardSchema = z.object({
  kind: z.enum(["item", "skillLevel", "upgrade", "gold"]),
  id: z.string().min(1),
  qty: z.number().int().min(1),
});
export type QuestReward = z.infer<typeof questRewardSchema>;

export const questSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(questStepSchema).min(1),
  rewards: z.array(questRewardSchema),
});
export type QuestContent = z.infer<typeof questSchema>;

export const eventModifierSchema = z.object({
  kind: z.enum(["productionMultiplier", "goldMultiplier", "xpMultiplier", "skillLevel"]),
  target: z.string().optional(),
  value: z.number(),
});
export type EventModifier = z.infer<typeof eventModifierSchema>;

export const eventSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  durationSec: z.number().int().min(1),
  modifiers: z.array(eventModifierSchema).min(1),
  weight: z.number().positive(),
});
export type EventContent = z.infer<typeof eventSchema>;

export const balanceSchema = z.object({
  skillRateK: z.number().min(0),
  xpBase: z.number().positive(),
  xpExponent: z.number().positive(),
  tradingDiscountPerLevel: z.number().min(0),
  tradingDiscountMax: z.number().min(0),
  marketDriftRange: z.number().min(0),
  marketDriftIntervalSec: z.number().int().min(1),
  maxTickSec: z.number().int().min(1),
  maxTickPerDaySec: z.number().int().min(1),
  offlineCapSec: z.number().int().min(1),
  rateBase: z.record(z.string(), z.number().positive()),
  costGrowth: z.record(z.string(), z.number().min(1)),
});
export type BalanceContent = z.infer<typeof balanceSchema>;

export const skillsFileSchema = z.array(skillSchema);
export const itemsFileSchema = z.array(itemSchema);
export const recipesFileSchema = z.array(recipeSchema);
export const upgradesFileSchema = z.array(upgradeSchema);
export const monstersFileSchema = z.array(monsterSchema);
export const zonesFileSchema = z.array(zoneSchema);
export const questsFileSchema = z.array(questSchema);
export const eventsFileSchema = z.array(eventSchema);

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
export type GameContent = z.infer<typeof gameContentSchema>;
