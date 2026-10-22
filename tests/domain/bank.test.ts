import { test } from "vitest";
import assert from "node:assert/strict";
import { bankOperation } from "../../src/domain/game/actions.ts";
import {
	accrueInterest,
	applyGoldIncome,
	creditLimit,
} from "../../src/domain/game/bank.ts";
import { tick } from "../../src/domain/game/tick.ts";
import { createInitialState } from "../../src/domain/game/state.ts";
import { prestige } from "../../src/domain/game/prestige.ts";
import type { GameContent } from "../../src/domain/content/types.ts";
import type { GameState } from "../../src/domain/game/types.ts";

const CONTENT: GameContent = {
	skills: [],
	items: [],
	recipes: [],
	upgrades: [
		{
			id: "bank",
			name: "Банк",
			maxLevel: 5,
			costBase: 100,
			costGrowth: 1.35,
			effect: { kind: "passiveIncome", valuePerLevel: 0.5 },
		},
	],
	monsters: [],
	zones: [],
	quests: [],
	events: [],
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
		rateBase: {},
		costGrowth: { bank: 1.35 },
		prestigeProductionExponent: 0.15,
		prestigeGoldExponent: 0.2,
		eventChancePerMinute: 0,
		playerMaxHp: 100,
		playerDamageBase: 1,
		playerDamagePerLevel: 0.5,
		bankCreditLimitPerLevel: 500,
		bankInterestPerHour: 0.15,
		bankRepayShareOfIncome: 0.5,
	},
};

function state(overrides: Partial<GameState> = {}): GameState {
	const base = createInitialState("p1", 42, 1000);
	return { ...base, ...overrides };
}

test("credit limit grows with the bank upgrade level", () => {
	assert.equal(creditLimit(state(), CONTENT), 0);
	assert.equal(creditLimit(state({ upgrades: { bank: 2 } }), CONTENT), 1000);
});

test("credit without a bank upgrade is rejected", () => {
	const result = bankOperation(
		state(),
		CONTENT,
		{ kind: "credit", amount: 100 },
		1000,
	);
	assert.equal(result.isErr(), true);
	assert.equal(result.isErr() && result.error.code, "CreditLimitExceeded");
});

test("credit above the limit is rejected and leaves the state untouched", () => {
	const before = state({ upgrades: { bank: 1 } });
	const result = bankOperation(
		before,
		CONTENT,
		{ kind: "credit", amount: 501 },
		1000,
	);
	assert.equal(result.isErr(), true);
	assert.equal(result.isErr() && result.error.code, "CreditLimitExceeded");
});

test("credit adds gold and records the debt", () => {
	const before = state({ upgrades: { bank: 1 } });
	const result = bankOperation(
		before,
		CONTENT,
		{ kind: "credit", amount: 200 },
		1000,
	);
	assert.equal(result.isErr(), false);
	if (result.isErr()) return;
	assert.equal(result.value.wallet.gold, 200);
	assert.equal(result.value.bank.credit, 200);
});

test("interest accrues on the debt over time", () => {
	const before = state({
		upgrades: { bank: 1 },
		bank: { deposits: 0, credit: 1000, accruedAt: 1000 },
	});
	const after = accrueInterest(before, CONTENT, 3600);
	assert.equal(after.bank.credit, 1150);
});

test("a share of every gold income goes to the debt", () => {
	const before = state({
		upgrades: { bank: 1 },
		bank: { deposits: 0, credit: 100, accruedAt: 1000 },
	});
	const after = applyGoldIncome(before, CONTENT, 200);
	assert.equal(after.bank.credit, 0);
	assert.equal(after.wallet.gold, 100);
});

test("passive income repays the debt during a tick", () => {
	const before = state({
		upgrades: { bank: 1 },
		bank: { deposits: 0, credit: 100, accruedAt: 1000 },
		lastTickAt: 1000,
	});
	const after = tick(before, { content: CONTENT, now: 1000 + 60 });
	assert.ok(after.bank.credit < 100);
	assert.ok(after.wallet.gold < 30);
});

test("repay pays the debt from the wallet", () => {
	const before = state({
		wallet: { gold: 300, credits: 0 },
		bank: { deposits: 0, credit: 200, accruedAt: 1000 },
	});
	const result = bankOperation(
		before,
		CONTENT,
		{ kind: "repay", amount: 100 },
		1000,
	);
	assert.equal(result.isErr(), false);
	if (result.isErr()) return;
	assert.equal(result.value.bank.credit, 100);
	assert.equal(result.value.wallet.gold, 200);
});

test("repay is capped by the outstanding debt", () => {
	const before = state({
		wallet: { gold: 300, credits: 0 },
		bank: { deposits: 0, credit: 50, accruedAt: 1000 },
	});
	const result = bankOperation(
		before,
		CONTENT,
		{ kind: "repay", amount: 100 },
		1000,
	);
	assert.equal(result.isErr(), false);
	if (result.isErr()) return;
	assert.equal(result.value.bank.credit, 0);
	assert.equal(result.value.wallet.gold, 250);
});

test("repay without a debt is rejected", () => {
	const result = bankOperation(
		state(),
		CONTENT,
		{ kind: "repay", amount: 10 },
		1000,
	);
	assert.equal(result.isErr(), true);
	assert.equal(result.isErr() && result.error.code, "NotSupported");
});

test("prestige keeps the debt", () => {
	const before = state({
		upgrades: { bank: 1 },
		stats: { totalGoldEarned: 5000 },
		bank: { deposits: 0, credit: 300, accruedAt: 1000 },
	});
	const result = prestige(before, CONTENT, 2000);
	assert.equal(result.isErr(), false);
	if (result.isErr()) return;
	assert.equal(result.value.bank.credit, 300);
});
