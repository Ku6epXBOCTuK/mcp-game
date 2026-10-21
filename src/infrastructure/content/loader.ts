import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Result, ok, err } from "neverthrow";
import type { GameContent } from "../../domain/content/types.ts";
import type { DomainError } from "../../domain/shared/errors.ts";
import { contentInvalidError } from "../../domain/shared/result.ts";
import {
  balanceSchema,
  eventsFileSchema,
  gameContentSchema,
  itemsFileSchema,
  monstersFileSchema,
  questsFileSchema,
  recipesFileSchema,
  skillsFileSchema,
  upgradesFileSchema,
  zonesFileSchema,
} from "./schemas.ts";
import type { z } from "zod";

export type ContentFileName =
  | "skills.json"
  | "items.json"
  | "recipes.json"
  | "upgrades.json"
  | "monsters.json"
  | "zones.json"
  | "quests.json"
  | "events.json"
  | "balance.json";

export interface ContentRepository {
  load(): Promise<Result<GameContent, DomainError>>;
}

const FILE_SCHEMAS = {
  "skills.json": skillsFileSchema,
  "items.json": itemsFileSchema,
  "recipes.json": recipesFileSchema,
  "upgrades.json": upgradesFileSchema,
  "monsters.json": monstersFileSchema,
  "zones.json": zonesFileSchema,
  "quests.json": questsFileSchema,
  "events.json": eventsFileSchema,
  "balance.json": balanceSchema,
} as const;

type FileName = keyof typeof FILE_SCHEMAS;

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

export class FileContentRepository implements ContentRepository {
  private cached: GameContent | null = null;
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  async load(): Promise<Result<GameContent, DomainError>> {
    if (this.cached) return ok(this.cached);
    const loaded = await this.readAll();
    if (loaded.isErr()) return loaded;
    this.cached = loaded.value;
    return loaded;
  }

  invalidate(): void {
    this.cached = null;
  }

  private async readAll(): Promise<Result<GameContent, DomainError>> {
    const files: Partial<Record<FileName, unknown>> = {};

    for (const name of Object.keys(FILE_SCHEMAS) as FileName[]) {
      const raw = await this.readFile(name);
      if (raw.isErr()) return err(raw.error);
      files[name] = raw.value;
    }

    const parsed = gameContentSchema.safeParse({
      skills: files["skills.json"],
      items: files["items.json"],
      recipes: files["recipes.json"],
      upgrades: files["upgrades.json"],
      monsters: files["monsters.json"],
      zones: files["zones.json"],
      quests: files["quests.json"],
      events: files["events.json"],
      balance: files["balance.json"],
    });

    if (!parsed.success) {
      return err(
        contentInvalidError("content", "gameContent", formatIssues(parsed.error)),
      );
    }

    return this.checkReferences(parsed.data);
  }

  private async readFile(name: FileName): Promise<Result<unknown, DomainError>> {
    const path = join(this.root, name);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err(
        contentInvalidError(path, name, `файл не прочитан: ${detail}`),
      );
    }
    try {
      return ok(JSON.parse(text) as unknown);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return err(
        contentInvalidError(path, name, `невалидный JSON: ${detail}`),
      );
    }
  }

  private checkReferences(content: GameContent): Result<GameContent, DomainError> {
    const itemIds = new Set(content.items.map((item) => item.id));
    const recipeIds = new Set(content.recipes.map((recipe) => recipe.id));
    const monsterIds = new Set(content.monsters.map((monster) => monster.id));
    const questIds = new Set(content.quests.map((quest) => quest.id));
    const upgradeIds = new Set(content.upgrades.map((upgrade) => upgrade.id));
    const zoneIds = new Set(content.zones.map((zone) => zone.id));

    for (const recipe of content.recipes) {
      if (!itemIds.has(recipe.output.item)) {
        return err(
          contentInvalidError(
            "content/recipes.json",
            recipe.id,
            `output ссылается на неизвестный предмет "${recipe.output.item}"`,
          ),
        );
      }
      for (const input of recipe.inputs) {
        if (!itemIds.has(input.item)) {
          return err(
            contentInvalidError(
              "content/recipes.json",
              recipe.id,
              `input ссылается на неизвестный предмет "${input.item}"`,
            ),
          );
        }
      }
    }

    for (const monster of content.monsters) {
      if (!zoneIds.has(monster.zone)) {
        return err(
          contentInvalidError(
            "content/monsters.json",
            monster.id,
            `ссылка на неизвестную зону "${monster.zone}"`,
          ),
        );
      }
      for (const drop of monster.dropTable) {
        if (!itemIds.has(drop.item)) {
          return err(
            contentInvalidError(
              "content/monsters.json",
              monster.id,
              `drop ссылается на неизвестный предмет "${drop.item}"`,
            ),
          );
        }
      }
    }

    for (const zone of content.zones) {
      for (const monsterId of zone.monsters) {
        if (!monsterIds.has(monsterId)) {
          return err(
            contentInvalidError(
              "content/zones.json",
              zone.id,
              `ссылка на неизвестного монстра "${monsterId}"`,
            ),
          );
        }
      }
      if (zone.unlock.kind === "quest" && !questIds.has(zone.unlock.quest)) {
        return err(
          contentInvalidError(
            "content/zones.json",
            zone.id,
            `unlock ссылается на неизвестный квест "${zone.unlock.quest}"`,
          ),
        );
      }
    }

    for (const quest of content.quests) {
      for (const reward of quest.rewards) {
        if (reward.kind === "item" && !itemIds.has(reward.id)) {
          return err(
            contentInvalidError(
              "content/quests.json",
              quest.id,
              `награда ссылается на неизвестный предмет "${reward.id}"`,
            ),
          );
        }
        if (reward.kind === "upgrade" && !upgradeIds.has(reward.id)) {
          return err(
            contentInvalidError(
              "content/quests.json",
              quest.id,
              `награда ссылается на неизвестный апгрейд "${reward.id}"`,
            ),
          );
        }
      }
      for (const step of quest.steps) {
        if (step.kind === "craft" && !recipeIds.has(step.target)) {
          return err(
            contentInvalidError(
              "content/quests.json",
              quest.id,
              `шаг крафта ссылается на неизвестный рецепт "${step.target}"`,
            ),
          );
        }
        if (step.kind === "kill" && !monsterIds.has(step.target)) {
          return err(
            contentInvalidError(
              "content/quests.json",
              quest.id,
              `шаг убийства ссылается на неизвестного монстра "${step.target}"`,
            ),
          );
        }
      }
    }

    return ok(content);
  }
}
