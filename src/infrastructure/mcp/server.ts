import { McpServer } from "@modelcontextprotocol/server";
import type { GameService } from "../../application/use-cases/game-service.ts";
import { createToolDefinitions } from "./tools.ts";
import { scopeError, type McpScope } from "./tool-result.ts";
import { strategyPrompt } from "./strategy.ts";

export const SERVER_INFO = { name: "mcp-idle-game", version: "0.1.0" };

export type McpServerDeps = {
  games: GameService;
  dev: boolean;
};

export type McpServerFactory = (options: {
  playerId: string;
  scopes: McpScope[];
}) => McpServer;

export function createMcpServerFactory(deps: McpServerDeps): McpServerFactory {
  const definitions = createToolDefinitions(deps);

  return ({ playerId, scopes }) => {
    const server = new McpServer(SERVER_INFO);

    for (const definition of definitions) {
      const config = {
        title: definition.title,
        description: definition.description,
        ...(definition.inputSchema ? { inputSchema: definition.inputSchema } : {}),
      };
      server.registerTool(
        definition.name,
        config,
        async (raw: unknown) => {
          const missing = definition.scopes.filter((scope) => !scopes.includes(scope));
          if (missing.length > 0) return scopeError(missing);
          const args = (raw ?? {}) as Record<string, unknown>;
          return definition.handler(args, { playerId, scopes });
        },
      );
    }

    server.registerResource(
      "game-state",
      "game://state",
      { title: "Состояние игры", mimeType: "application/json" },
      async (uri) => {
        const result = await deps.games.getState(playerId);
        if (result.isErr()) {
          return { contents: [{ uri: uri.href, text: result.error.message }] };
        }
        const { state } = result.value;
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  wallet: state.wallet,
                  bank: state.bank,
                  health: state.health,
                  inventory: state.inventory,
                  skills: state.skills,
                  activeAction: state.activeAction,
                  activeEvents: state.activeEvents,
                  upgrades: state.upgrades,
                  prestige: state.prestige,
                  quests: state.quests,
                  counters: state.counters,
                  stats: state.stats,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerResource(
      "game-skills",
      "game://skills",
      { title: "Скиллы", mimeType: "application/json" },
      async (uri) => {
        const result = await deps.games.getState(playerId);
        if (result.isErr()) {
          return { contents: [{ uri: uri.href, text: result.error.message }] };
        }
        const { state, content } = result.value;
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  skills: state.skills,
                  recipes: content.recipes.map((recipe) => ({
                    id: recipe.id,
                    skill: recipe.skill,
                    skillLevel: recipe.skillLevel,
                    output: recipe.output,
                    inputs: recipe.inputs,
                    timeSec: recipe.timeSec,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerResource(
      "game-market",
      "game://market",
      { title: "Рынок", mimeType: "application/json" },
      async (uri) => {
        const prices = await deps.games.marketPrices(playerId);
        if (prices.isErr()) {
          return { contents: [{ uri: uri.href, text: prices.error.message }] };
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify({ prices: prices.value }, null, 2),
            },
          ],
        };
      },
    );

    server.registerResource(
      "game-quests",
      "game://quests",
      { title: "Квесты", mimeType: "application/json" },
      async (uri) => {
        const result = await deps.games.questProgress(playerId);
        if (result.isErr()) {
          return { contents: [{ uri: uri.href, text: result.error.message }] };
        }
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                result.value.map((entry) => ({
                  id: entry.quest.id,
                  name: entry.quest.name,
                  status: entry.status,
                  steps: entry.steps.map((step) => ({
                    kind: step.step.kind,
                    target: step.step.target,
                    current: step.current,
                    required: step.required,
                  })),
                })),
                null,
                2,
              ),
            },
          ],
        };
      },
    );

    server.registerPrompt(
      "game_strategy",
      {
        title: "Стратегия игры",
        description:
          "Как эффективно играть: порядок покупок, расчёт окупаемости, момент престижа.",
      },
      async () => ({
        messages: [
          {
            role: "user",
            content: { type: "text", text: strategyPrompt() },
          },
        ],
      }),
    );

    return server;
  };
}
