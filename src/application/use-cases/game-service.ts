import type { ContentRepository } from "../ports/content-repository.ts";
import type { Clock } from "../ports/clock.ts";
import type { GameRepository } from "../ports/game-repository.ts";
import type { PlayerRepository } from "../ports/player-repository.ts";
import type { GameContent } from "../../domain/content/types.ts";
import type { DomainError } from "../../domain/shared/errors.ts";
import { type Result, ok, err } from "neverthrow";
import { createInitialState } from "../../domain/game/state.ts";
import { tick } from "../../domain/game/tick.ts";
import type {
	GameEvent,
	GameState,
	PlayerId,
	QuestId,
	SkillId,
} from "../../domain/game/types.ts";
import {
	startAction,
	cancelAction,
	buyUpgrade,
	bankOperation,
	type BankOperation,
	type StartActionCommand,
} from "../../domain/game/actions.ts";
import { sellItem, buyItem } from "../../domain/game/trade.ts";
import { useItem } from "../../domain/game/health.ts";
import { claimQuest } from "../../domain/game/quest-rewards.ts";
import { allQuestProgress } from "../../domain/game/quests.ts";
import { prestige, previewPrestige } from "../../domain/game/prestige.ts";
import { marketBuyPrice, marketSellPrice } from "../../domain/game/market.ts";

export type GameContext = {
	state: GameState;
	content: GameContent;
	version: number;
};

export type UseCaseResult<T> = Result<T, DomainError>;

export class GameService {
	private readonly games: GameRepository;
	private readonly players: PlayerRepository;
	private readonly content: ContentRepository;
	private readonly clock: Clock;

	constructor(deps: {
		games: GameRepository;
		players: PlayerRepository;
		content: ContentRepository;
		clock: Clock;
	}) {
		this.games = deps.games;
		this.players = deps.players;
		this.content = deps.content;
		this.clock = deps.clock;
	}

	async loadContent(): Promise<UseCaseResult<GameContent>> {
		return this.content.load();
	}

	async ensurePlayer(
		playerId: PlayerId,
		label = "player",
	): Promise<UseCaseResult<void>> {
		const existing = await this.players.findById(playerId);
		if (existing) return ok(undefined);
		await this.players.create({
			id: playerId,
			label,
			createdAt: this.clock.now(),
		});
		return ok(undefined);
	}

	async loadContext(playerId: PlayerId): Promise<UseCaseResult<GameContext>> {
		const contentResult = await this.content.load();
		if (contentResult.isErr()) return err(contentResult.error);
		const content = contentResult.value;
		const now = this.clock.now();
		const ensured = await this.ensurePlayer(playerId);
		if (ensured.isErr()) return err(ensured.error);
		const stored = await this.games.load(playerId);
		if (!stored) {
			const seed = hashSeed(`${playerId}:${now}`);
			const state = createInitialState(playerId, seed, now);
			await this.games.save(playerId, state, 1);
			return ok({ state, content, version: 1 });
		}
		const state = tick(stored.state, { content, now });
		if (state === stored.state) {
			return ok({ state, content, version: stored.version });
		}
		const version = stored.version + 1;
		await this.games.save(playerId, state, version);
		return ok({ state, content, version });
	}

	private async commit(
		playerId: PlayerId,
		context: GameContext,
		events: GameEvent[],
	): Promise<void> {
		const version = context.version + 1;
		await this.games.save(playerId, context.state, version);
		context.version = version;
		if (events.length > 0) {
			await this.games.appendEvents(playerId, events);
		}
	}

	async getState(playerId: PlayerId): Promise<UseCaseResult<GameContext>> {
		return this.loadContext(playerId);
	}

	async startAction(
		playerId: PlayerId,
		command: StartActionCommand,
	): Promise<UseCaseResult<GameContext>> {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		const now = this.clock.now();
		const result = startAction(
			context.value.state,
			context.value.content,
			command,
			now,
		);
		if (result.isErr()) {
			await this.logError(playerId, now, result.error);
			return err(result.error);
		}
		const next = { ...context.value, state: result.value };
		await this.commit(playerId, next, [
			{
				ts: now,
				type: "action.started",
				payload: {
					kind: command.kind,
					target: "targetId" in command ? command.targetId : "",
				},
			},
		]);
		return ok(next);
	}

	async cancelAction(playerId: PlayerId): Promise<UseCaseResult<GameContext>> {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		const now = this.clock.now();
		const result = cancelAction(context.value.state, now);
		if (result.isErr()) {
			await this.logError(playerId, now, result.error);
			return err(result.error);
		}
		const next = { ...context.value, state: result.value };
		await this.commit(playerId, next, [
			{ ts: now, type: "action.cancelled", payload: {} },
		]);
		return ok(next);
	}

	async craft(
		playerId: PlayerId,
		recipeId: string,
	): Promise<UseCaseResult<GameContext>> {
		return this.startAction(playerId, { kind: "craft", recipeId });
	}

	async fight(
		playerId: PlayerId,
		monsterId: string,
	): Promise<UseCaseResult<GameContext>> {
		return this.startAction(playerId, { kind: "fight", monsterId });
	}

	async gather(
		playerId: PlayerId,
		skill: SkillId,
		targetId: string,
	): Promise<UseCaseResult<GameContext>> {
		return this.startAction(playerId, { kind: "gather", skill, targetId });
	}

	async buyUpgrade(
		playerId: PlayerId,
		upgradeId: string,
	): Promise<UseCaseResult<GameContext>> {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		const now = this.clock.now();
		const result = buyUpgrade(
			context.value.state,
			context.value.content,
			upgradeId,
			now,
		);
		if (result.isErr()) {
			await this.logError(playerId, now, result.error);
			return err(result.error);
		}
		const next = { ...context.value, state: result.value };
		await this.commit(playerId, next, [
			{
				ts: now,
				type: "upgrade.bought",
				payload: { upgradeId, level: next.state.upgrades[upgradeId] ?? 0 },
			},
		]);
		return ok(next);
	}

	async useItem(
		playerId: PlayerId,
		itemId: string,
	): Promise<UseCaseResult<GameContext>> {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		const now = this.clock.now();
		const result = useItem(
			context.value.state,
			context.value.content,
			itemId,
			now,
		);
		if (result.isErr()) {
			await this.logError(playerId, now, result.error);
			return err(result.error);
		}
		const next = { ...context.value, state: result.value };
		await this.commit(playerId, next, [
			{
				ts: now,
				type: "item.used",
				payload: { itemId, hp: result.value.health.hp },
			},
		]);
		return ok(next);
	}

	async sell(
		playerId: PlayerId,
		itemId: string,
		qty: number,
	): Promise<UseCaseResult<GameContext>> {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		const now = this.clock.now();
		const result = sellItem(
			context.value.state,
			context.value.content,
			itemId,
			qty,
			now,
		);
		if (result.isErr()) {
			await this.logError(playerId, now, result.error);
			return err(result.error);
		}
		const next = { ...context.value, state: result.value };
		await this.commit(playerId, next, [
			{ ts: now, type: "item.sold", payload: { itemId, qty } },
		]);
		return ok(next);
	}

	async buy(
		playerId: PlayerId,
		itemId: string,
		qty: number,
	): Promise<UseCaseResult<GameContext>> {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		const now = this.clock.now();
		const result = buyItem(
			context.value.state,
			context.value.content,
			itemId,
			qty,
			now,
		);
		if (result.isErr()) {
			await this.logError(playerId, now, result.error);
			return err(result.error);
		}
		const next = { ...context.value, state: result.value };
		await this.commit(playerId, next, [
			{ ts: now, type: "item.bought", payload: { itemId, qty } },
		]);
		return ok(next);
	}

	async bank(
		playerId: PlayerId,
		operation: BankOperation,
	): Promise<UseCaseResult<GameContext>> {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		const now = this.clock.now();
		const result = bankOperation(
			context.value.state,
			context.value.content,
			operation,
			now,
		);
		if (result.isErr()) {
			await this.logError(playerId, now, result.error);
			return err(result.error);
		}
		const next = { ...context.value, state: result.value };
		await this.commit(playerId, next, [
			{
				ts: now,
				type: `bank.${operation.kind}`,
				payload: {
					amount: operation.amount,
					credit: result.value.bank.credit,
				},
			},
		]);
		return ok(next);
	}

	async claimQuest(
		playerId: PlayerId,
		questId: QuestId,
	): Promise<UseCaseResult<GameContext>> {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		const now = this.clock.now();
		const result = claimQuest(
			context.value.state,
			context.value.content,
			questId,
			now,
		);
		if (result.isErr()) {
			await this.logError(playerId, now, result.error);
			return err(result.error);
		}
		const next = { ...context.value, state: result.value };
		await this.commit(playerId, next, [
			{ ts: now, type: "quest.claimed", payload: { questId } },
		]);
		return ok(next);
	}

	async prestige(playerId: PlayerId): Promise<UseCaseResult<GameContext>> {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		const now = this.clock.now();
		const result = prestige(context.value.state, context.value.content, now);
		if (result.isErr()) {
			await this.logError(playerId, now, result.error);
			return err(result.error);
		}
		const next = { ...context.value, state: result.value };
		await this.commit(playerId, next, [
			{
				ts: now,
				type: "prestige",
				payload: {
					points: next.state.prestige.points,
					layers: next.state.prestige.layers,
				},
			},
		]);
		return ok(next);
	}

	async questProgress(playerId: PlayerId) {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		return ok(allQuestProgress(context.value.state, context.value.content));
	}

	async prestigePreview(playerId: PlayerId) {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		return ok(previewPrestige(context.value.state, context.value.content));
	}

	async marketPrices(playerId: PlayerId) {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		const { state, content } = context.value;
		return ok(
			content.items.map((item) => ({
				itemId: item.id,
				sell: Math.floor(marketSellPrice(state, content, item.id)),
				buy: Math.ceil(marketBuyPrice(state, content, item.id)),
			})),
		);
	}

	async advanceTime(
		playerId: PlayerId,
		seconds: number,
	): Promise<UseCaseResult<GameContext>> {
		const context = await this.loadContext(playerId);
		if (context.isErr()) return err(context.error);
		const realNow = this.clock.now();
		const future = realNow + Math.max(0, Math.floor(seconds));
		const ticked = tick(context.value.state, {
			content: context.value.content,
			now: future,
		});
		const state = {
			...ticked,
			lastTickAt: realNow,
			updatedAt: realNow,
			market: {
				...ticked.market,
				updatedAt: Math.min(ticked.market.updatedAt, realNow),
			},
		};
		const next = {
			...context.value,
			state,
			version: context.value.version + 1,
		};
		await this.commit(playerId, next, [
			{ ts: realNow, type: "time.advanced", payload: { seconds } },
		]);
		return ok(next);
	}

	async listEvents(playerId: PlayerId, limit = 50): Promise<GameEvent[]> {
		return this.games.listEvents(playerId, limit);
	}

	async firstPlayerId(): Promise<PlayerId | null> {
		const players = await this.players.list();
		return players[0]?.id ?? null;
	}

	async describePlayer(
		playerId: PlayerId,
	): Promise<{ id: PlayerId; label: string } | null> {
		const player = await this.players.findById(playerId);
		return player ? { id: player.id, label: player.label } : null;
	}

	private async logError(
		playerId: PlayerId,
		ts: number,
		error: DomainError,
	): Promise<void> {
		await this.games.appendEvents(playerId, [
			{ ts, type: `error.${error.code}`, payload: { message: error.message } },
		]);
	}
}

function hashSeed(input: string): number {
	let hash = 2166136261;
	for (let i = 0; i < input.length; i += 1) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
