import { test } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FileContentRepository } from "../../src/infrastructure/content/loader.ts";
import {
	marketBuyPrice,
	marketSellPrice,
	refreshMarket,
	safeDriftRange,
} from "../../src/domain/game/market.ts";
import { createInitialState } from "../../src/domain/game/state.ts";
import { tradingDiscount } from "../../src/domain/shared/curves.ts";
import type { GameState } from "../../src/domain/game/types.ts";

const contentDir = join(import.meta.dirname, "..", "..", "content");
const START = 1_700_000_000;
const INTERVAL_SEC = 300;

async function loadContent() {
	const repo = new FileContentRepository(contentDir);
	const result = await repo.load();
	assert.equal(result.isOk(), true);
	if (result.isErr()) throw new Error("content must load");
	return result.value;
}

function stateWithTradingLevel(level: number): GameState {
	const state = createInitialState("player", 7, START);
	return {
		...state,
		skills: {
			...state.skills,
			trading: { id: "trading", level, xp: 0 },
		},
	};
}

test("the market price never leaves the band around the base price", async () => {
	const content = await loadContent();
	let current = stateWithTradingLevel(1);
	for (let i = 1; i <= 300; i++) {
		current = refreshMarket(current, content, START + i * INTERVAL_SEC);
	}
	for (const item of content.items) {
		if (item.sellPrice <= 0) continue;
		const price = current.market.prices[item.id] ?? 0;
		assert.ok(
			price >= item.sellPrice * 0.7 - 1e-6,
			`${item.id}: ${price} ниже пола`,
		);
		assert.ok(
			price <= item.sellPrice * 1.3 + 1e-6,
			`${item.id}: ${price} выше потолка`,
		);
	}
});

test("no round trip can profit at any trading level", async () => {
	const content = await loadContent();
	for (const level of [1, 5, 10, 20]) {
		const discount = tradingDiscount(level);
		for (const item of content.items) {
			if (item.sellPrice <= 0 || item.buyPrice <= 0) continue;
			const range = safeDriftRange(content, item, discount);
			const sellMax = item.sellPrice * (1 + range) * (1 + discount);
			const buyMin = item.buyPrice * (1 - range);
			assert.ok(
				sellMax < buyMin,
				`${item.id} (ур. ${level}): продать ${sellMax} < купить ${buyMin}`,
			);
		}
	}
});

test("the trader skill raises the sell price but not the buy price", async () => {
	const content = await loadContent();
	const low = stateWithTradingLevel(1);
	const high = stateWithTradingLevel(20);
	assert.equal(
		marketBuyPrice(low, content, "wood"),
		marketBuyPrice(high, content, "wood"),
	);
	assert.ok(
		marketSellPrice(high, content, "wood") >
			marketSellPrice(low, content, "wood"),
	);
});

test("the market catches up with a long offline gap", async () => {
	const content = await loadContent();
	const state = stateWithTradingLevel(1);
	const now = START + 12 * 3600;
	const after = refreshMarket(state, content, now);
	assert.ok(after.market.updatedAt > state.market.updatedAt);
	assert.ok(
		now - after.market.updatedAt < INTERVAL_SEC,
		"рынок отстал от игрового времени",
	);
	const moved = Object.entries(after.market.prices).filter(
		([id, price]) =>
			Math.abs(
				price - (content.items.find((i) => i.id === id)?.sellPrice ?? 0),
			) > 0.01,
	);
	assert.ok(moved.length > 0, "market drift steps did not apply");
});

test("the market does not depend on the poll interval", async () => {
	const content = await loadContent();
	const state = stateWithTradingLevel(1);
	const hours = 12;
	const once = refreshMarket(state, content, START + hours * 3600);
	let many = state;
	const steps = (hours * 3600) / INTERVAL_SEC;
	for (let i = 1; i <= steps; i++) {
		many = refreshMarket(many, content, START + i * INTERVAL_SEC);
	}
	assert.deepEqual(once.market.prices, many.market.prices);
	assert.equal(once.market.updatedAt, many.market.updatedAt);
});
