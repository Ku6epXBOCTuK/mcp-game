import { test } from "node:test";
import assert from "node:assert/strict";
import { tick } from "../../src/domain/game/tick.ts";
import { createInitialState } from "../../src/domain/game/state.ts";
import { marketSellPrice } from "../../src/domain/game/market.ts";
import type { GameContent } from "../../src/domain/content/types.ts";
import type { ActiveAction, GameState } from "../../src/domain/game/types.ts";

const CONTENT: GameContent = {
	skills: [],
	items: [
		{
			id: "wood",
			name: "Дерево",
			type: "resource",
			sellPrice: 10,
			buyPrice: 20,
		},
		{
			id: "pelt",
			name: "Шкура",
			type: "resource",
			sellPrice: 25,
			buyPrice: 50,
		},
	],
	recipes: [
		{
			id: "make_plank",
			output: { item: "plank", qty: 1 },
			inputs: [{ item: "wood", qty: 2 }],
			skill: "crafting",
			skillLevel: 1,
			timeSec: 10,
		},
	],
	upgrades: [
		{
			id: "bank",
			name: "Банк",
			maxLevel: 10,
			costBase: 100,
			costGrowth: 1.35,
			effect: { kind: "passiveIncome", valuePerLevel: 0.5 },
		},
	],
	monsters: [
		{
			id: "wolf",
			name: "Волк",
			zone: "forest",
			hp: 10,
			damage: 1,
			attackInterval: 5,
			xp: 20,
			dropTable: [{ item: "pelt", chance: 1, qty: 1 }],
		},
	],
	zones: [],
	quests: [],
	events: [
		{
			id: "fair",
			name: "Ярмарка",
			durationSec: 600,
			modifiers: [{ kind: "productionMultiplier", value: 2 }],
			weight: 1,
		},
		{
			id: "riot",
			name: "Бунт",
			durationSec: 300,
			modifiers: [{ kind: "goldMultiplier", value: 3 }],
			weight: 1,
		},
	],
	balance: {
		skillRateK: 0.1,
		xpBase: 15,
		xpExponent: 1.4,
		tradingDiscountPerLevel: 0.02,
		tradingDiscountMax: 0.4,
		marketDriftRange: 0.3,
		marketDriftIntervalSec: 300,
		maxTickSec: 3600,
		maxTickPerDaySec: 86400,
		offlineCapSec: 43200,
		rateBase: { chopping: 1 },
		costGrowth: { bank: 1.35 },
		prestigeProductionExponent: 0.15,
		prestigeGoldExponent: 0.2,
		eventChancePerMinute: 0,
		playerMaxHp: 100,
		playerDamageBase: 1,
		playerDamagePerLevel: 0.5,
	},
};

function state(overrides: Partial<GameState> = {}): GameState {
	return { ...createInitialState("p1", 42, 1000), ...overrides };
}

function gatherAction(targetId = "wood"): ActiveAction {
	return {
		kind: "gather",
		skill: "chopping",
		targetId,
		startedAt: 1000,
		endsAt: 1000 + 60,
		progress: 0,
	};
}

test("gathering fills the gathered counter", () => {
	const after = tick(state({ activeAction: gatherAction() }), {
		content: CONTENT,
		now: 1600,
	});
	assert.equal(after.counters.gathered.wood, 11);
});

test("crafting fills the crafted counter and consumes inputs", () => {
	const before = state({
		activeAction: {
			kind: "craft",
			skill: "crafting",
			targetId: "make_plank",
			startedAt: 1000,
			endsAt: 2000,
			progress: 0,
		},
		inventory: { wood: 20 },
	});
	const after = tick(before, { content: CONTENT, now: 1060 });
	assert.equal(after.counters.crafted.make_plank, 6);
	assert.equal(after.inventory.plank, 6);
	assert.equal(after.inventory.wood, 8);
});

test("crafting stops when inputs run out", () => {
	const before = state({
		activeAction: {
			kind: "craft",
			skill: "crafting",
			targetId: "make_plank",
			startedAt: 1000,
			endsAt: 2000,
			progress: 0,
		},
		inventory: { wood: 4 },
	});
	const after = tick(before, { content: CONTENT, now: 1060 });
	assert.equal(after.counters.crafted.make_plank, 2);
	assert.equal(after.inventory.wood, undefined);
});

test("killing a monster fills the killed counter", () => {
	const before = state({
		activeAction: {
			kind: "fight",
			skill: "combat",
			targetId: "wolf",
			startedAt: 1000,
			endsAt: 2000,
			progress: 0,
		},
	});
	const after = tick(before, { content: CONTENT, now: 1010 });
	assert.equal(after.counters.killed.wolf, 1);
});

test("market prices drift after the drift interval", () => {
	const before = state({
		market: { seed: 7, counter: 0, prices: {}, updatedAt: 1000 },
	});
	const unchanged = tick(before, { content: CONTENT, now: 1200 });
	assert.deepEqual(unchanged.market.prices, {});

	const drifted = tick(before, { content: CONTENT, now: 1400 });
	assert.ok(Object.keys(drifted.market.prices).length > 0);
	assert.ok(drifted.market.counter > 0);
	assert.equal(drifted.market.updatedAt, 1300);
});

test("drifted market prices change the sell price of an item", () => {
	const base = state({
		market: { seed: 7, counter: 0, prices: {}, updatedAt: 1000 },
	});
	const drifted = tick(base, { content: CONTENT, now: 1400 });
	const price = drifted.market.prices.wood ?? 0;
	assert.ok(price > 0);
	assert.equal(marketSellPrice(drifted, CONTENT, "wood"), price * 1.02);
});

test("offline progress is limited by the offline cap", () => {
	const before = state({ activeAction: gatherAction() });
	const after = tick(before, { content: CONTENT, now: 1000 + 100_000 });
	const expected = Math.floor((43200 / 60) * 1 * 1.1);
	assert.equal(after.inventory.wood, expected);
});

test("the offline cap also limits passive income", () => {
	const before = state({ upgrades: { bank: 1 } });
	const after = tick(before, { content: CONTENT, now: 1000 + 100_000 });
	assert.equal(after.wallet.gold, 0.5 * 43200);
});

test("the tick updates the market even without an active action", () => {
	const before = state();
	const after = tick(before, { content: CONTENT, now: 1400 });
	assert.equal(after.market.updatedAt, 1300);
	assert.equal(after.activeAction, null);
});
