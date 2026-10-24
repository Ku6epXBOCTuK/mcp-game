import { z } from "zod";
import type {
	GameService,
	StateDigest,
} from "../../application/use-cases/game-service.ts";
import type { GameEvent, GameState } from "../../domain/game/types.ts";
import type { SkillId } from "../../domain/game/types.ts";
import type { GameContent } from "../../domain/content/types.ts";
import { tradingDiscount, xpToNext } from "../../domain/shared/curves.ts";
import {
	describeAction,
	MAX_PAUSED_ACTIONS,
	upgradePrice,
} from "../../domain/game/actions.ts";
import { maxCraftsByInputs } from "../../domain/game/tick.ts";
import {
	forecastCombat,
	playerDpsFor,
	type CombatPolicyPatch,
} from "../../domain/game/combat.ts";
import { maxHpFor } from "../../domain/game/health.ts";
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

function optionalPercent(value: unknown): number | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	return Number(value);
}

// NOTE: passive income and interest leave sub-coin dust in the state; every
// answer rounds the money down, so agents only ever see whole coins.
function wholeCoins(gold: number): number {
	return Math.floor(gold);
}

function moneyView(state: GameState) {
	return {
		wallet: { ...state.wallet, gold: wholeCoins(state.wallet.gold) },
		bank: {
			...state.bank,
			deposits: wholeCoins(state.bank.deposits),
			credit: wholeCoins(state.bank.credit),
		},
	};
}

function activeForecast(state: GameState, content: GameContent) {
	const action = state.activeAction;
	if (!action || action.kind !== "fight") return null;
	const monster = content.monsters.find(
		(entry) => entry.id === action.targetId,
	);
	if (!monster) return null;
	return forecastCombat({
		monster,
		monsterHpLeft: action.monsterHpLeft,
		nextMonsterHitInSec: action.monsterHitInSec,
		playerDps: playerDpsFor(state, content, action.damageMultiplier ?? 1),
		playerHp: state.health.hp,
		playerMaxHp: maxHpFor(state, content),
	});
}

const DIGEST_LINE_LIMIT = 50;

// NOTE: action.started and action.cancelled echo the agent's own commands back
// synchronously; the digest reports only what happened without the agent.
function digestLine(event: GameEvent): string {
	switch (event.type) {
		case "action.completed":
			return `Крафт ${event.payload.recipeId} завершён`;
		case "action.exhausted":
			return `Крафт ${event.payload.recipeId} остановлен: кончился вход ${event.payload.item}`;
		case "action.dropped":
			return `Отложенное выброшено: ${(event.payload.targets as string[] | undefined)?.join(", ") ?? ""}`;
		case "action.discarded":
			return `Отложенное выброшено: ${event.payload.target}`;
		case "combat.kill": {
			const count =
				typeof event.payload.count === "number" ? event.payload.count : 1;
			return count > 1
				? `Убито ${event.payload.monsterId} ×${count}`
				: `Убит ${event.payload.monsterId}`;
		}
		case "combat.death": {
			const count =
				typeof event.payload.count === "number" ? event.payload.count : 1;
			return count > 1 ? `Смертей в бою: ${count}` : `Смерть в бою`;
		}
		case "skill.levelUp":
			return `Скилл ${event.payload.skillId} вырос до уровня ${event.payload.level}`;
		case "world.eventStarted":
			return `Началось мировое событие ${event.payload.eventId}`;
		case "time.advanced":
			return `Пропущено времени: ${event.payload.seconds}с`;
		case "prestige":
			return `Престиж: очков ${event.payload.points}, слоёв ${event.payload.layers}`;
		case "quest.claimed":
			return `Награда за квест ${event.payload.questId} получена`;
		case "upgrade.bought":
			return `Апгрейд ${event.payload.upgradeId} → уровень ${event.payload.level}`;
		case "item.used":
			return `Использован предмет ${event.payload.itemId}`;
		case "item.sold":
			return `Продано ${event.payload.itemId} ×${event.payload.qty}`;
		case "item.bought":
			return `Куплено ${event.payload.itemId} ×${event.payload.qty}`;
		case "combat.policy":
			return "Изменена боевая политика";
		default: {
			if (event.type.startsWith("bank.")) {
				return `Банк ${event.type.slice(5)}: ${event.payload.amount} золота`;
			}
			if (event.type.startsWith("error.")) {
				return `Ошибка: ${event.payload.message ?? event.type}`;
			}
			return `${event.type} ${JSON.stringify(event.payload)}`;
		}
	}
}

function digestView(digest: StateDigest) {
	const relevant = digest.events.filter(
		(event) =>
			event.type !== "action.started" && event.type !== "action.cancelled",
	);
	const lines = relevant.slice(0, DIGEST_LINE_LIMIT).map(digestLine);
	return {
		sinceTs: digest.sinceTs,
		total: relevant.length,
		lines,
		omitted: Math.max(0, relevant.length - lines.length),
	};
}

function snapshot(
	state: GameState,
	content: GameContent,
	now: number,
	digest: StateDigest,
) {
	return {
		playerId: state.playerId,
		now,
		...moneyView(state),
		health: state.health,
		inventory: state.inventory,
		skills: state.skills,
		activeAction: state.activeAction,
		pausedActions: state.pausedActions ?? [],
		activeEvents: state.activeEvents,
		upgrades: state.upgrades,
		prestige: state.prestige,
		quests: state.quests,
		counters: state.counters,
		stats: state.stats,
		combatPolicy: state.combatPolicy,
		combatBuffs: state.combatBuffs ?? [],
		combat: activeForecast(state, content),
		marketUpdatedAt: state.market.updatedAt,
		digest: digestView(digest),
	};
}

export function createToolDefinitions(deps: Deps): McpToolDefinition[] {
	const { games } = deps;

	const gameState: McpToolDefinition = {
		name: "game_state",
		title: "Состояние игры",
		description:
			"Полный снимок игрока: кошелёк, инвентарь, скиллы, активное действие, апгрейды, престиж, квесты. Поле digest перечисляет события с прошлого вызова game_state: завершения крафтов, исчерпание входов, убийства, смерти, левелапы, мировые события.",
		scopes: ["read"],
		handler: async (_args, context) => {
			const result = await games.readStateWithDigest(context.playerId);
			if (result.isErr()) return errorResultFromDomain(result.error);
			return jsonResult(
				snapshot(
					result.value.context.state,
					result.value.context.content,
					Math.floor(Date.now() / 1000),
					result.value.digest,
				),
			);
		},
	};

	const gameAction: McpToolDefinition = {
		name: "game_action",
		title: "Действие",
		description:
			"Управление активным действием: start (собрать/сварить/атаковать), cancel (отложить — прогресс сохраняется, но отложенное не производит), discard (выбросить отложенное), status. " +
			`Отложенных держится максимум ${MAX_PAUSED_ACTIONS}: при переполнении самое старое выбрасывается вместе с прогрессом. ` +
			"Повторный start того же действия продолжает его с сохранённого прогресса.",
		scopes: ["play"],
		inputSchema: z.object({
			command: z.enum(["start", "cancel", "discard", "status"]),
			kind: z.enum(["gather", "craft", "fight"]).optional(),
			skill: z.string().optional(),
			targetId: z.string().optional(),
			recipeId: z.string().optional(),
			monsterId: z.string().optional(),
			qty: z.number().int().positive().optional(),
		}),
		handler: async (args, context) => {
			const command = String(args.command ?? "");
			if (command === "status") {
				const result = await games.getState(context.playerId);
				if (result.isErr()) return errorResultFromDomain(result.error);
				return jsonResult({
					activeAction: result.value.state.activeAction,
					pausedActions: result.value.state.pausedActions ?? [],
					pausedLimit: MAX_PAUSED_ACTIONS,
				});
			}
			if (command === "cancel") {
				const result = await games.cancelAction(context.playerId);
				if (result.isErr()) return errorResultFromDomain(result.error);
				const state = result.value.state;
				const paused = state.pausedActions ?? [];
				const dropped = result.value.droppedPaused ?? [];
				const cancelled = paused[paused.length - 1];
				const message = [
					cancelled
						? `Действие "${describeAction(cancelled)}" отложено: прогресс сохранён, но пока оно отложено — оно не производит. Возобновить — game_action start с тем же kind и targetId.`
						: "",
					`Слоты отложенных: ${paused.length}/${MAX_PAUSED_ACTIONS}.`,
					dropped.length > 0
						? `Внимание: слоты были переполнены, самое старое отложенное выброшено вместе с прогрессом: ${dropped.join(", ")}.`
						: "",
				]
					.filter(Boolean)
					.join(" ");
				return jsonResult({
					message,
					activeAction: state.activeAction,
					pausedActions: paused,
					pausedLimit: MAX_PAUSED_ACTIONS,
					dropped,
				});
			}
			if (command === "discard") {
				const target = args.targetId ? String(args.targetId) : undefined;
				const result = await games.discardPausedActions(
					context.playerId,
					target,
				);
				if (result.isErr()) return errorResultFromDomain(result.error);
				return jsonResult({
					activeAction: result.value.state.activeAction,
					pausedActions: result.value.state.pausedActions ?? [],
				});
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
					args.qty === undefined ? undefined : Number(args.qty),
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
			"Начать крафт по рецепту: проверяются ресурсы, уровень скилла и рецепт. " +
			"qty — партия: сделать N единиц и остановиться (или раньше, если кончатся входы). " +
			"Без qty цикл вечный. Ответ содержит maxAffordable — сколько единиц хватит сырья.",
		scopes: ["play"],
		inputSchema: z.object({
			recipeId: z.string(),
			qty: z.number().int().positive().optional(),
		}),
		handler: async (args, context) => {
			const qty = args.qty === undefined ? undefined : Number(args.qty);
			const recipeId = String(args.recipeId ?? "");
			const result = await games.craft(context.playerId, recipeId, qty);
			if (result.isErr()) return errorResultFromDomain(result.error);
			const { state, content } = result.value;
			const recipe = content.recipes.find((entry) => entry.id === recipeId);
			const affordable = recipe ? maxCraftsByInputs(state, recipe.inputs) : 0;
			const maxAffordable = Number.isFinite(affordable) ? affordable : null;
			const message =
				qty !== undefined && maxAffordable !== null && maxAffordable < qty
					? `Входов хватит только на ${maxAffordable} из ${qty} — партия остановится раньше по сырью.`
					: undefined;
			return jsonResult({
				action: state.activeAction,
				maxAffordable,
				...(message ? { message } : {}),
			});
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
					gold: wholeCoins(result.value.state.wallet.gold),
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
				gold: wholeCoins(result.value.state.wallet.gold),
				inventory: result.value.state.inventory,
			});
		},
	};

	const gameUse: McpToolDefinition = {
		name: "game_use",
		title: "Использовать предмет",
		description:
			"Выпить зелье здоровья (itemId=potion_health): восстанавливает HP, бой не прерывается. " +
			"Пей зелье, когда HP падает, иначе бой закончится смертью. " +
			"Зелье силы (itemId=potion_strength) и эликсир (itemId=elixir) дают усиленный урон: " +
			"они действуют на текущий бой, а если боя нет — на следующий. " +
			"Эликсир заодно полностью восстанавливает HP.",
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
				combatBuffs: result.value.state.combatBuffs ?? [],
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
			return jsonResult(moneyView(result.value.state));
		},
	};

	const gameCombat: McpToolDefinition = {
		name: "game_combat",
		title: "Бой",
		description:
			"Карта зон и монстров со статами; fight — начать бой с монстром; " +
			"forecast — прогноз боя (сколько секунд до убийства, до смерти, можно ли победить); " +
			"policy — правила боя для афк-режима: когда пить зелье, когда отступать, повторять ли бой, " +
			"пить ли зелье силы, когда бой проигрывается.",
		scopes: ["read", "play"],
		inputSchema: z.object({
			command: z.enum(["map", "fight", "forecast", "policy"]).default("map"),
			monsterId: z.string().optional(),
			potionAtHpPercent: z.number().min(0).max(100).nullable().optional(),
			fleeAtHpPercent: z.number().min(0).max(100).nullable().optional(),
			autoRepeat: z.boolean().optional(),
			strengthPotionWhenLosing: z.boolean().optional(),
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
			if (command === "forecast") {
				const monsterId = args.monsterId ? String(args.monsterId) : undefined;
				const result = await games.combatForecast(context.playerId, monsterId);
				if (result.isErr()) return errorResultFromDomain(result.error);
				if (!result.value)
					return errorResult(
						"UnknownCommand: для forecast нужен monsterId или активный бой.",
					);
				return jsonResult(result.value);
			}
			if (command === "policy") {
				const patch: CombatPolicyPatch = {
					potionAtHpPercent: optionalPercent(args.potionAtHpPercent),
					fleeAtHpPercent: optionalPercent(args.fleeAtHpPercent),
					autoRepeat:
						typeof args.autoRepeat === "boolean" ? args.autoRepeat : undefined,
					strengthPotionWhenLosing:
						typeof args.strengthPotionWhenLosing === "boolean"
							? args.strengthPotionWhenLosing
							: undefined,
				};
				const result = await games.setCombatPolicy(context.playerId, patch);
				if (result.isErr()) return errorResultFromDomain(result.error);
				return jsonResult(result.value.state.combatPolicy);
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
			"Уровни и XP скиллов, цель следующего уровня, добываемые ресурсы и доступные рецепты по скиллу.",
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
			const resources = content.items
				.filter((item) => item.skill && (only ? item.skill === only : true))
				.map((item) => {
					const skillLevel = state.skills[item.skill ?? "chopping"]?.level ?? 1;
					return {
						id: item.id,
						name: item.name,
						skill: item.skill,
						sellPrice: item.sellPrice,
						requiredLevel: item.skillLevel ?? 1,
						available: skillLevel >= (item.skillLevel ?? 1),
						ratePerMinute: Math.round(
							(content.balance.rateBase[item.skill ?? ""] ?? 0) *
								(1 + content.balance.skillRateK * skillLevel),
						),
					};
				});
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
			const tradingLevel = state.skills.trading?.level ?? 1;
			const trading = {
				level: tradingLevel,
				sellBonusPercent: Math.round(tradingDiscount(tradingLevel) * 100),
				xpPerGold: content.balance.tradingXpPerGold ?? 0.1,
			};
			return jsonResult({ skills, resources, recipes, trading });
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
				`Время продвинуто на ${seconds} с. Золото: ${wholeCoins(result.value.state.wallet.gold)}. Инвентарь: ${JSON.stringify(result.value.state.inventory)}.`,
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
