import { z } from "zod";
import type { GameService } from "../../application/use-cases/game-service.ts";
import type { GameState } from "../../domain/game/types.ts";
import type { SkillId } from "../../domain/game/types.ts";
import { xpToNext } from "../../domain/shared/curves.ts";
import { upgradePrice } from "../../domain/game/actions.ts";
import {
	errorResult,
	errorResultFromDomain,
	jsonResult,
	textResult,
	type McpToolDefinition,
} from "./tool-result.ts";

type Deps = {
	games: GameService;
	dev: boolean;
};

function skillView(state: GameState, base: number, exponent: number) {
	return Object.values(state.skills).map((skill) => ({
		id: skill.id,
		level: skill.level,
		xp: skill.xp,
		xpToNext: xpToNext(skill.level, base, exponent),
	}));
}

function snapshot(state: GameState, now: number) {
	return {
		playerId: state.playerId,
		now,
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
		marketUpdatedAt: state.market.updatedAt,
	};
}

export function createToolDefinitions(deps: Deps): McpToolDefinition[] {
	const { games } = deps;

	const gameState: McpToolDefinition = {
		name: "game_state",
		title: "Состояние игры",
		description:
			"Полный снимок игрока: кошелёк, инвентарь, скиллы, активное действие, апгрейды, престиж, квесты.",
		scopes: ["read"],
		handler: async (_args, context) => {
			const result = await games.getState(context.playerId);
			if (result.isErr()) return errorResultFromDomain(result.error);
			return jsonResult(
				snapshot(result.value.state, Math.floor(Date.now() / 1000)),
			);
		},
	};

	const gameAction: McpToolDefinition = {
		name: "game_action",
		title: "Действие",
		description:
			"Управление активным действием: start (собрать/сварить/атаковать), cancel, status.",
		scopes: ["play"],
		inputSchema: z.object({
			command: z.enum(["start", "cancel", "status"]),
			kind: z.enum(["gather", "craft", "fight"]).optional(),
			skill: z.string().optional(),
			targetId: z.string().optional(),
			recipeId: z.string().optional(),
			monsterId: z.string().optional(),
		}),
		handler: async (args, context) => {
			const command = String(args.command ?? "");
			if (command === "status") {
				const result = await games.getState(context.playerId);
				if (result.isErr()) return errorResultFromDomain(result.error);
				return jsonResult(result.value.state.activeAction);
			}
			if (command === "cancel") {
				const result = await games.cancelAction(context.playerId);
				if (result.isErr()) return errorResultFromDomain(result.error);
				return jsonResult(result.value.state.activeAction);
			}
			if (command !== "start") {
				return errorResult(`UnknownCommand: неизвестная команда "${command}".`);
			}
			const kind = String(args.kind ?? "");
			let result;
			if (kind === "gather") {
				const skill = String(args.skill ?? "") as SkillId;
				const targetId = String(args.targetId ?? "");
				result = await games.gather(context.playerId, skill, targetId);
			} else if (kind === "craft") {
				result = await games.craft(
					context.playerId,
					String(args.recipeId ?? ""),
				);
			} else if (kind === "fight") {
				result = await games.fight(
					context.playerId,
					String(args.monsterId ?? ""),
				);
			} else {
				return errorResult(
					"UnknownCommand: нужно указать kind = gather | craft | fight и соответствующие поля.",
				);
			}
			if (result.isErr()) return errorResultFromDomain(result.error);
			return jsonResult(result.value.state.activeAction);
		},
	};

	const gameCraft: McpToolDefinition = {
		name: "game_craft",
		title: "Крафт",
		description:
			"Начать крафт по рецепту: проверяются ресурсы, уровень скилла и рецепт.",
		scopes: ["play"],
		inputSchema: z.object({ recipeId: z.string() }),
		handler: async (args, context) => {
			const result = await games.craft(
				context.playerId,
				String(args.recipeId ?? ""),
			);
			if (result.isErr()) return errorResultFromDomain(result.error);
			return jsonResult(result.value.state.activeAction);
		},
	};

	const gameUpgrades: McpToolDefinition = {
		name: "game_upgrades",
		title: "Апгрейды",
		description:
			"Список апгрейдов с текущими ценами и эффектами; buy — купить следующий уровень.",
		scopes: ["read", "play"],
		inputSchema: z.object({
			command: z.enum(["list", "buy"]).default("list"),
			upgradeId: z.string().optional(),
		}),
		handler: async (args, context) => {
			const command = String(args.command ?? "list");
			if (command === "buy") {
				const upgradeId = String(args.upgradeId ?? "");
				if (!upgradeId)
					return errorResult("UnknownCommand: для buy нужен upgradeId.");
				const result = await games.buyUpgrade(context.playerId, upgradeId);
				if (result.isErr()) return errorResultFromDomain(result.error);
				return jsonResult({
					upgradeId,
					level: result.value.state.upgrades[upgradeId] ?? 0,
					gold: result.value.state.wallet.gold,
				});
			}
			const contextResult = await games.getState(context.playerId);
			if (contextResult.isErr())
				return errorResultFromDomain(contextResult.error);
			const { state, content } = contextResult.value;
			const list = content.upgrades.map((upgrade) => {
				const level = state.upgrades[upgrade.id] ?? 0;
				return {
					id: upgrade.id,
					name: upgrade.name,
					level,
					maxLevel: upgrade.maxLevel,
					nextCost:
						level >= upgrade.maxLevel
							? null
							: upgradePrice(content, upgrade.id, level),
					effect: upgrade.effect,
				};
			});
			return jsonResult(list);
		},
	};

	const gameTrade: McpToolDefinition = {
		name: "game_trade",
		title: "Торговля",
		description:
			"Продать или купить предмет по текущей рыночной цене (sell/buy, itemId, qty).",
		scopes: ["play"],
		inputSchema: z.object({
			command: z.enum(["sell", "buy"]),
			itemId: z.string(),
			qty: z.number().int().positive(),
		}),
		handler: async (args, context) => {
			const command = String(args.command ?? "");
			const itemId = String(args.itemId ?? "");
			const qty = Number(args.qty ?? 0);
			const result =
				command === "sell"
					? await games.sell(context.playerId, itemId, qty)
					: await games.buy(context.playerId, itemId, qty);
			if (result.isErr()) return errorResultFromDomain(result.error);
			return jsonResult({
				itemId,
				qty,
				gold: result.value.state.wallet.gold,
				inventory: result.value.state.inventory,
			});
		},
	};

	const gameUse: McpToolDefinition = {
		name: "game_use",
		title: "Использовать предмет",
		description:
			"Выпить зелье здоровья (itemId=potion_health): восстанавливает HP, бой не прерывается. " +
			"Пей зелье, когда HP падает, иначе бой закончится смертью.",
		scopes: ["play"],
		inputSchema: z.object({
			itemId: z.string(),
		}),
		handler: async (args, context) => {
			const itemId = String(args.itemId ?? "");
			const result = await games.useItem(context.playerId, itemId);
			if (result.isErr()) return errorResultFromDomain(result.error);
			return jsonResult({
				itemId,
				health: result.value.state.health,
				inventory: result.value.state.inventory,
			});
		},
	};

	const gameBank: McpToolDefinition = {
		name: "game_bank",
		title: "Банк",
		description:
			"Операции банка: deposit, withdraw, credit, repay (amount в золоте). " +
			"credit — кредит под процент: лимит = уровень апгрейда bank × лимит на уровень, " +
			"на долг начисляется процент, а доля дохода автоматически идёт на погашение. " +
			"repay — досрочное погашение долга из кошелька.",
		scopes: ["play"],
		inputSchema: z.object({
			command: z.enum(["deposit", "withdraw", "credit", "repay"]),
			amount: z.number().int().positive(),
		}),
		handler: async (args, context) => {
			const command = String(args.command ?? "");
			const amount = Number(args.amount ?? 0);
			const result = await games.bank(context.playerId, {
				kind: command as "deposit" | "withdraw" | "credit" | "repay",
				amount,
			});
			if (result.isErr()) return errorResultFromDomain(result.error);
			return jsonResult({
				wallet: result.value.state.wallet,
				bank: result.value.state.bank,
			});
		},
	};

	const gameCombat: McpToolDefinition = {
		name: "game_combat",
		title: "Бой",
		description:
			"Карта зон и монстров со статами; fight — начать бой с монстром.",
		scopes: ["read", "play"],
		inputSchema: z.object({
			command: z.enum(["map", "fight"]).default("map"),
			monsterId: z.string().optional(),
		}),
		handler: async (args, context) => {
			const command = String(args.command ?? "map");
			if (command === "fight") {
				const monsterId = String(args.monsterId ?? "");
				if (!monsterId)
					return errorResult("UnknownCommand: для fight нужен monsterId.");
				const result = await games.fight(context.playerId, monsterId);
				if (result.isErr()) return errorResultFromDomain(result.error);
				return jsonResult(result.value.state.activeAction);
			}
			const contextResult = await games.getState(context.playerId);
			if (contextResult.isErr())
				return errorResultFromDomain(contextResult.error);
			const { content } = contextResult.value;
			const zones = content.zones.map((zone) => ({
				id: zone.id,
				name: zone.name,
				unlock: zone.unlock,
				monsters: zone.monsters.map((id) => {
					const monster = content.monsters.find((entry) => entry.id === id);
					return monster
						? {
								id: monster.id,
								name: monster.name,
								hp: monster.hp,
								damage: monster.damage,
								attackInterval: monster.attackInterval,
								xp: monster.xp,
								dropTable: monster.dropTable,
							}
						: { id, missing: true };
				}),
			}));
			return jsonResult(zones);
		},
	};

	const gameQuests: McpToolDefinition = {
		name: "game_quests",
		title: "Квесты",
		description: "Прогресс квестов; claim — забрать награду.",
		scopes: ["read", "play"],
		inputSchema: z.object({
			command: z.enum(["list", "claim"]).default("list"),
			questId: z.string().optional(),
		}),
		handler: async (args, context) => {
			const command = String(args.command ?? "list");
			if (command === "claim") {
				const questId = String(args.questId ?? "");
				if (!questId)
					return errorResult("UnknownCommand: для claim нужен questId.");
				const result = await games.claimQuest(context.playerId, questId);
				if (result.isErr()) return errorResultFromDomain(result.error);
				return jsonResult({
					questId,
					status: result.value.state.quests[questId]?.status ?? "unknown",
					wallet: result.value.state.wallet,
				});
			}
			const result = await games.questProgress(context.playerId);
			if (result.isErr()) return errorResultFromDomain(result.error);
			return jsonResult(
				result.value.map((entry) => ({
					id: entry.quest.id,
					name: entry.quest.name,
					status: entry.status,
					completedSteps: entry.completedSteps,
					totalSteps: entry.totalSteps,
					steps: entry.steps.map((step) => ({
						kind: step.step.kind,
						target: step.step.target,
						current: step.current,
						required: step.required,
						done: step.done,
					})),
				})),
			);
		},
	};

	const gameMarket: McpToolDefinition = {
		name: "game_market",
		title: "Рынок",
		description: "Текущие цены продажи и покупки, время последнего дрейфа.",
		scopes: ["read"],
		handler: async (_args, context) => {
			const prices = await games.marketPrices(context.playerId);
			if (prices.isErr()) return errorResultFromDomain(prices.error);
			const contextResult = await games.getState(context.playerId);
			const updatedAt = contextResult.isErr()
				? null
				: contextResult.value.state.market.updatedAt;
			return jsonResult({ updatedAt, prices: prices.value });
		},
	};

	const gameSkills: McpToolDefinition = {
		name: "game_skills",
		title: "Скиллы",
		description:
			"Уровни и XP скиллов, цель следующего уровня, доступные рецепты по скиллу.",
		scopes: ["read"],
		inputSchema: z.object({ skill: z.string().optional() }),
		handler: async (args, context) => {
			const contextResult = await games.getState(context.playerId);
			if (contextResult.isErr())
				return errorResultFromDomain(contextResult.error);
			const { state, content } = contextResult.value;
			const only = args.skill ? String(args.skill) : null;
			const skills = skillView(
				state,
				content.balance.xpBase,
				content.balance.xpExponent,
			).filter((skill) => (only ? skill.id === only : true));
			const recipes = content.recipes
				.filter((recipe) => (only ? recipe.skill === only : true))
				.map((recipe) => ({
					id: recipe.id,
					skill: recipe.skill,
					output: recipe.output,
					inputs: recipe.inputs,
					skillLevel: recipe.skillLevel,
					timeSec: recipe.timeSec,
					available:
						(state.skills[recipe.skill]?.level ?? 0) >= recipe.skillLevel,
				}));
			return jsonResult({ skills, recipes });
		},
	};

	const gamePrestige: McpToolDefinition = {
		name: "game_prestige",
		title: "Престиж",
		description:
			"Предпросмотр престижа (сколько очков даст) и запуск нового захода.",
		scopes: ["read", "play"],
		inputSchema: z.object({
			command: z.enum(["preview", "start"]).default("preview"),
		}),
		handler: async (args, context) => {
			const command = String(args.command ?? "preview");
			if (command === "start") {
				const result = await games.prestige(context.playerId);
				if (result.isErr()) return errorResultFromDomain(result.error);
				return jsonResult(result.value.state.prestige);
			}
			const result = await games.prestigePreview(context.playerId);
			if (result.isErr()) return errorResultFromDomain(result.error);
			return jsonResult(result.value);
		},
	};

	const gameLog: McpToolDefinition = {
		name: "game_log",
		title: "Лента событий",
		description:
			"Лента событий игрока: что куплено, что сломано, что заблокировано.",
		scopes: ["read"],
		inputSchema: z.object({
			limit: z.number().int().positive().max(200).default(50),
		}),
		handler: async (args, context) => {
			const limit = Number(args.limit ?? 50);
			const events = await games.listEvents(context.playerId, limit);
			return jsonResult(events);
		},
	};

	const gameTick: McpToolDefinition = {
		name: "game_tick",
		title: "Продвинуть время",
		description:
			"Форсировать продвижение времени (секунды) для тестов, детерминизма и симуляций.",
		scopes: ["play"],
		inputSchema: z.object({ seconds: z.number().int().positive() }),
		handler: async (args, context) => {
			const contextResult = await games.getState(context.playerId);
			if (contextResult.isErr())
				return errorResultFromDomain(contextResult.error);
			const requested = Number(args.seconds ?? 0);
			const limit = contextResult.value.content.balance.maxTickSec;
			const seconds = deps.dev ? requested : Math.min(requested, limit);
			const result = await games.advanceTime(context.playerId, seconds);
			if (result.isErr()) return errorResultFromDomain(result.error);
			return textResult(
				`Время продвинуто на ${seconds} с. Золото: ${result.value.state.wallet.gold}. Инвентарь: ${JSON.stringify(result.value.state.inventory)}.`,
			);
		},
	};

	return [
		gameState,
		gameAction,
		gameCraft,
		gameUpgrades,
		gameTrade,
		gameUse,
		gameBank,
		gameCombat,
		gameQuests,
		gameMarket,
		gameSkills,
		gamePrestige,
		gameLog,
		gameTick,
	];
}
