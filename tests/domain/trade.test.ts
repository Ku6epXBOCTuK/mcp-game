import { test } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FileContentRepository } from "../../src/infrastructure/content/loader.ts";
import { sellItem, buyItem } from "../../src/domain/game/trade.ts";
import { marketSellPrice } from "../../src/domain/game/market.ts";
import { createInitialState } from "../../src/domain/game/state.ts";
import type { GameState } from "../../src/domain/game/types.ts";

const contentDir = join(import.meta.dirname, "..", "..", "content");
const START = 1_700_000_000;

async function loadContent() {
	const repo = new FileContentRepository(contentDir);
	const result = await repo.load();
	assert.equal(result.isOk(), true);
	if (result.isErr()) throw new Error("content must load");
	return result.value;
}

function stateWith(
	inventory: Record<string, number>,
	overrides: Partial<GameState> = {},
): GameState {
	const state = createInitialState("player", 7, START);
	return { ...state, inventory, ...overrides };
}

function withTradingLevel(state: GameState, level: number): GameState {
	return {
		...state,
		skills: { ...state.skills, trading: { id: "trading", level, xp: 0 } },
	};
}

test("selling pays trading xp proportional to the gold", async () => {
	const content = await loadContent();
	const state = stateWith({ wood: 10 });
	const result = sellItem(state, content, "wood", 10, START);
	assert.equal(result.isOk(), true);
	if (result.isErr()) return;
	const gold = Math.floor(marketSellPrice(state, content, "wood")) * 10;
	assert.equal(result.value.wallet.gold, gold);
	assert.ok(
		Math.abs(result.value.skills.trading.xp - gold * 0.1) < 1e-6,
		`xp=${result.value.skills.trading.xp}, ожидалось ${gold * 0.1}`,
	);
});

test("a higher trading level sells for more and pays more xp", async () => {
	const content = await loadContent();
	const low = withTradingLevel(stateWith({ gold_ingot: 10 }), 1);
	const high = withTradingLevel(stateWith({ gold_ingot: 10 }), 20);
	assert.ok(
		marketSellPrice(high, content, "gold_ingot") >
			marketSellPrice(low, content, "gold_ingot"),
	);
	const lowSell = sellItem(low, content, "gold_ingot", 10, START);
	const highSell = sellItem(high, content, "gold_ingot", 10, START);
	assert.equal(lowSell.isOk(), true);
	assert.equal(highSell.isOk(), true);
	if (lowSell.isErr() || highSell.isErr()) return;
	assert.ok(highSell.value.skills.trading.xp > lowSell.value.skills.trading.xp);
});

test("buying gives no trading xp", async () => {
	const content = await loadContent();
	const state = stateWith({}, { wallet: { gold: 10_000, credits: 0 } });
	const result = buyItem(state, content, "gold_ingot", 1, START);
	assert.equal(result.isOk(), true);
	if (result.isErr()) return;
	assert.equal(result.value.skills.trading.xp, 0);
	assert.equal(result.value.skills.trading.level, 1);
});

test("the xp multiplier upgrade applies to the trading xp", async () => {
	const content = await loadContent();
	const plain = stateWith({ wood: 10 });
	const tent = stateWith({ wood: 10 }, { upgrades: { tent: 1 } });
	const plainSell = sellItem(plain, content, "wood", 10, START);
	const tentSell = sellItem(tent, content, "wood", 10, START);
	assert.equal(plainSell.isOk(), true);
	assert.equal(tentSell.isOk(), true);
	if (plainSell.isErr() || tentSell.isErr()) return;
	const expected = plainSell.value.skills.trading.xp * 1.1;
	assert.ok(
		Math.abs(tentSell.value.skills.trading.xp - expected) < 1e-6,
		`xp=${tentSell.value.skills.trading.xp}, ожидалось ${expected}`,
	);
});

test("enough sales raise the trading level", async () => {
	const content = await loadContent();
	let state = stateWith({ wood: 1000 });
	const result = sellItem(state, content, "wood", 1000, START);
	assert.equal(result.isOk(), true);
	if (result.isErr()) return;
	state = result.value;
	assert.ok(state.skills.trading.level > 1, "trading level did not grow");
	assert.ok(state.skills.trading.xp >= 0);
});

test("buying increments the bought counter", async () => {
	const content = await loadContent();
	const state = { ...stateWith({}), wallet: { gold: 1000, credits: 0 } };
	const first = buyItem(state, content, "wood", 5, START);
	assert.equal(first.isOk(), true);
	if (first.isErr()) return;
	assert.equal(first.value.inventory.wood, 5);
	assert.equal(first.value.counters.bought.wood, 5);

	const second = buyItem(first.value, content, "wood", 2, START);
	assert.equal(second.isOk(), true);
	if (second.isErr()) return;
	assert.equal(second.value.counters.bought.wood, 7);
	assert.equal(second.value.inventory.wood, 7);
	assert.ok(second.value.wallet.gold < first.value.wallet.gold);
});
