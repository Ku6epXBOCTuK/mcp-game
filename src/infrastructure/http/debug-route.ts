import { z } from "zod";
import type { GameService } from "../../application/use-cases/game-service.ts";
import type { ApiKeyService } from "../identity/api-key-service.ts";
import type { SkillId } from "../../domain/game/types.ts";
import { xpToNext } from "../../domain/shared/curves.ts";
import { upgradePrice } from "../../domain/game/actions.ts";
import type { McpScope } from "../mcp/tool-result.ts";
import { authorize, type AuthMode } from "./auth.ts";

export type DebugRouteDeps = {
	games: GameService;
	keys: ApiKeyService;
	auth: AuthMode;
	dev: boolean;
	now: () => number;
};

export type DebugRoute = {
	handle: (request: Request) => Promise<Response>;
};

const actionSchema = z.object({
	command: z.enum([
		"start",
		"cancel",
		"buy_upgrade",
		"advance",
		"claim_quest",
		"sell",
		"buy",
	]),
	kind: z.enum(["gather", "craft", "fight"]).optional(),
	skill: z.string().optional(),
	targetId: z.string().optional(),
	recipeId: z.string().optional(),
	monsterId: z.string().optional(),
	upgradeId: z.string().optional(),
	questId: z.string().optional(),
	itemId: z.string().optional(),
	qty: z.number().int().positive().optional(),
	seconds: z.number().int().positive().optional(),
});

export function createDebugRoute(deps: DebugRouteDeps): DebugRoute {
	return {
		handle: async (request) => {
			const url = new URL(request.url);
			if (url.pathname === "/api/state" && request.method === "GET") {
				return handleState(request, deps);
			}
			if (url.pathname === "/api/action" && request.method === "POST") {
				return handleAction(request, deps);
			}
			return json({ error: "NotFound" }, 404);
		},
	};
}

async function handleState(
	request: Request,
	deps: DebugRouteDeps,
): Promise<Response> {
	const context = await authorize(request, {
		games: deps.games,
		keys: deps.keys,
		auth: deps.auth,
		dev: deps.dev,
		now: deps.now(),
	});
	if (!context.ok) return json({ error: context.body }, context.status);
	const snapshot = await buildSnapshot(context.playerId, context.scopes, deps);
	return json(snapshot);
}

async function handleAction(
	request: Request,
	deps: DebugRouteDeps,
): Promise<Response> {
	const context = await authorize(request, {
		games: deps.games,
		keys: deps.keys,
		auth: deps.auth,
		dev: deps.dev,
		now: deps.now(),
	});
	if (!context.ok) return json({ error: context.body }, context.status);
	if (!context.scopes.includes("play")) {
		return json({ error: "Недостаточно прав: нужен ключ со scope play." }, 403);
	}
	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return json({ error: "Тело запроса должно быть JSON." }, 400);
	}
	const parsed = actionSchema.safeParse(payload);
	if (!parsed.success) {
		return json({ error: `Неизвестная команда: ${parsed.error.message}` }, 400);
	}
	const args = parsed.data;
	const playerId = context.playerId;
	const games = deps.games;

	const result = await (async () => {
		switch (args.command) {
			case "start": {
				if (args.kind === "gather") {
					return games.gather(
						playerId,
						String(args.skill ?? "") as SkillId,
						String(args.targetId ?? ""),
					);
				}
				if (args.kind === "craft") {
					return games.craft(playerId, String(args.recipeId ?? ""));
				}
				if (args.kind === "fight") {
					return games.fight(playerId, String(args.monsterId ?? ""));
				}
				return null;
			}
			case "cancel":
				return games.cancelAction(playerId);
			case "buy_upgrade":
				return games.buyUpgrade(playerId, String(args.upgradeId ?? ""));
			case "advance": {
				const seconds = Number(args.seconds ?? 0);
				const content = await games.loadContent();
				if (content.isErr()) return content;
				const limit = content.value.balance.maxTickSec;
				const applied = deps.dev ? seconds : Math.min(seconds, limit);
				return games.advanceTime(playerId, applied);
			}
			case "claim_quest":
				return games.claimQuest(playerId, String(args.questId ?? ""));
			case "sell":
				return games.sell(
					playerId,
					String(args.itemId ?? ""),
					Number(args.qty ?? 1),
				);
			case "buy":
				return games.buy(
					playerId,
					String(args.itemId ?? ""),
					Number(args.qty ?? 1),
				);
		}
	})();

	if (!result) {
		return json({ error: "Неизвестная команда." }, 400);
	}
	if (result.isErr()) {
		return json(
			{ error: `${result.error.code}: ${result.error.message}` },
			400,
		);
	}
	return json({ ok: true });
}

async function buildSnapshot(
	playerId: string,
	scopes: McpScope[],
	deps: DebugRouteDeps,
): Promise<Record<string, unknown>> {
	const context = await deps.games.getState(playerId);
	if (context.isErr()) {
		return { error: context.error.message };
	}
	const { state, content } = context.value;
	const player = await deps.games.describePlayer(playerId);
	const prices = await deps.games.marketPrices(playerId);
	const quests = await deps.games.questProgress(playerId);
	const events = await deps.games.listEvents(playerId, 30);

	const itemName = new Map(content.items.map((item) => [item.id, item.name]));

	return {
		player: player ?? { id: playerId, label: "player" },
		dev: deps.dev,
		auth: deps.auth,
		canPlay: scopes.includes("play"),
		now: deps.now(),
		wallet: state.wallet,
		bank: state.bank,
		health: state.health,
		inventory: Object.entries(state.inventory).map(([itemId, qty]) => ({
			itemId,
			name: itemName.get(itemId) ?? itemId,
			qty,
		})),
		skills: Object.values(state.skills).map((skill) => ({
			id: skill.id,
			name:
				content.skills.find((entry) => entry.id === skill.id)?.name ?? skill.id,
			level: skill.level,
			xp: skill.xp,
			xpToNext: xpToNext(
				skill.level,
				content.balance.xpBase,
				content.balance.xpExponent,
			),
		})),
		activeAction: state.activeAction,
		activeEvents: state.activeEvents.map((event) => ({
			id: event.id,
			name:
				content.events.find((entry) => entry.id === event.id)?.name ?? event.id,
			endsAt: event.endsAt,
		})),
		upgrades: content.upgrades.map((upgrade) => {
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
		}),
		prestige: state.prestige,
		quests: quests.isErr()
			? []
			: quests.value.map((entry) => ({
					id: entry.quest.id,
					name: entry.quest.name,
					status: entry.status,
					completedSteps: entry.completedSteps,
					totalSteps: entry.totalSteps,
				})),
		market: prices.isErr()
			? { updatedAt: state.market.updatedAt, prices: [] }
			: {
					updatedAt: state.market.updatedAt,
					prices: prices.value.map((price) => ({
						itemId: price.itemId,
						name: itemName.get(price.itemId) ?? price.itemId,
						sell: price.sell,
						buy: price.buy,
					})),
				},
		counters: state.counters,
		events: events.map((event) => ({
			ts: event.ts,
			type: event.type,
			payload: event.payload,
		})),
	};
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body, null, 2), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}
