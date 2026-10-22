import { test } from "vitest";
import assert from "node:assert/strict";
import {
	DEFAULT_SKILL_RATE_K,
	MARKET_DRIFT_RANGE,
	MAX_TRADING_DISCOUNT,
	marketPrice,
	prestigeMultiplier,
	productionRate,
	totalXpToReach,
	tradingDiscount,
	upgradeCost,
	xpToNext,
} from "../../src/domain/shared/curves.ts";

test("xpToNext follows 15 * level^1.4", () => {
	assert.equal(xpToNext(1), 15);
	assert.ok(Math.abs(xpToNext(2) - 15 * Math.pow(2, 1.4)) < 1e-9);
	assert.ok(xpToNext(10) > xpToNext(5));
});

test("xpToNext rejects levels below 1", () => {
	assert.throws(() => xpToNext(0), RangeError);
	assert.throws(() => xpToNext(-1), RangeError);
});

test("totalXpToReach sums the curve", () => {
	assert.equal(totalXpToReach(1), 0);
	assert.ok(Math.abs(totalXpToReach(3) - (xpToNext(1) + xpToNext(2))) < 1e-9);
});

test("upgradeCost follows base * growth^level", () => {
	assert.equal(upgradeCost(100, 1.15, 0), 100);
	assert.ok(
		Math.abs(upgradeCost(100, 1.15, 3) - 100 * Math.pow(1.15, 3)) < 1e-9,
	);
	assert.throws(() => upgradeCost(100, 0.9, 1), RangeError);
	assert.throws(() => upgradeCost(100, 1.15, -1), RangeError);
});

test("productionRate multiplies skill, upgrade and prestige factors", () => {
	const base = { rateBase: 10, skillLevel: 5 };
	assert.ok(
		Math.abs(productionRate(base) - 10 * (1 + DEFAULT_SKILL_RATE_K * 5)) < 1e-9,
	);
	assert.ok(
		Math.abs(
			productionRate({ ...base, upgradeMult: 2, prestigeMult: 3 }) -
				productionRate(base) * 6,
		) < 1e-9,
	);
	assert.equal(productionRate({ rateBase: 10, skillLevel: 0 }), 10);
});

test("tradingDiscount caps at 40%", () => {
	assert.equal(tradingDiscount(0), 0);
	assert.ok(Math.abs(tradingDiscount(5) - 0.1) < 1e-9);
	assert.equal(tradingDiscount(20), MAX_TRADING_DISCOUNT);
	assert.equal(tradingDiscount(100), MAX_TRADING_DISCOUNT);
});

test("marketPrice drifts within plus or minus 30%", () => {
	assert.equal(marketPrice(100, 0), 100);
	assert.ok(
		Math.abs(marketPrice(100, 1) - 100 * (1 + MARKET_DRIFT_RANGE)) < 1e-9,
	);
	assert.ok(
		Math.abs(marketPrice(100, -1) - 100 * (1 - MARKET_DRIFT_RANGE)) < 1e-9,
	);
	assert.throws(() => marketPrice(100, 1.5), RangeError);
	assert.throws(() => marketPrice(100, -1.5), RangeError);
});

test("prestigeMultiplier grows with points", () => {
	assert.equal(prestigeMultiplier(0, 0.5), 1);
	assert.ok(prestigeMultiplier(100, 0.5) > prestigeMultiplier(10, 0.5));
	assert.throws(() => prestigeMultiplier(-1, 0.5), RangeError);
});
