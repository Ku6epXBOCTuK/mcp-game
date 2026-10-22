import { test } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FileContentRepository } from "../../src/infrastructure/content/loader.ts";
import {
	simulate,
	PAYBACK_MIN_SEC,
	PAYBACK_MAX_SEC,
} from "../../src/domain/game/simulator.ts";
import { questProgress } from "../../src/domain/game/quests.ts";

const contentDir = join(import.meta.dirname, "..", "..", "content");

async function loadContent() {
	const repo = new FileContentRepository(contentDir);
	const result = await repo.load();
	assert.equal(result.isOk(), true);
	if (result.isErr()) throw new Error("content must load");
	return result.value;
}

test("simulation produces metrics for a six hour run", async () => {
	const content = await loadContent();
	const { state, metrics } = simulate({
		content,
		durationSec: 6 * 3600,
		seed: 5,
	});
	assert.equal(metrics.durationSec, 6 * 3600);
	assert.ok(metrics.totalIncome > 0);
	assert.ok(metrics.goldPerMinute > 0);
	assert.ok(metrics.stages.length > 0);
	assert.ok(metrics.idleRatio >= 0 && metrics.idleRatio <= 1);
	assert.ok(state.skills.chopping);
});

test("simulation is deterministic for the same seed", async () => {
	const content = await loadContent();
	const first = simulate({ content, durationSec: 3600, seed: 11 });
	const second = simulate({ content, durationSec: 3600, seed: 11 });
	assert.equal(first.metrics.totalIncome, second.metrics.totalIncome);
	assert.equal(first.metrics.medianPaybackSec, second.metrics.medianPaybackSec);
	assert.equal(first.state.wallet.gold, second.state.wallet.gold);
});

test("different seeds change the market drift outcome", async () => {
	const content = await loadContent();
	const first = simulate({ content, durationSec: 3600, seed: 1 });
	const second = simulate({ content, durationSec: 3600, seed: 2 });
	assert.notEqual(
		JSON.stringify(first.state.market.prices),
		JSON.stringify(second.state.market.prices),
	);
});

test("upgrade purchases record a payback time", async () => {
	const content = await loadContent();
	const { metrics } = simulate({ content, durationSec: 12 * 3600, seed: 7 });
	assert.ok(metrics.purchases.length > 0);
	const withPayback = metrics.purchases.filter(
		(purchase) => purchase.paybackSec !== null,
	);
	assert.ok(withPayback.length > 0);
	for (const purchase of withPayback) {
		assert.ok((purchase.paybackSec ?? 0) > 0);
		assert.equal(purchase.measurable, true);
	}
});

test("bottlenecks list upgrades that do not pay back in time", async () => {
	const content = await loadContent();
	const { metrics } = simulate({ content, durationSec: 12 * 3600, seed: 7 });
	for (const id of metrics.bottlenecks) {
		const purchases = metrics.purchases.filter(
			(purchase) => purchase.upgradeId === id,
		);
		assert.ok(purchases.length > 0);
	}
});

test("criteria reflect the measured metrics", async () => {
	const content = await loadContent();
	const { metrics } = simulate({ content, durationSec: 12 * 3600, seed: 7 });
	const median = metrics.medianPaybackSec;
	if (median !== null) {
		assert.equal(
			metrics.criteria.paybackInRange,
			median >= PAYBACK_MIN_SEC && median <= PAYBACK_MAX_SEC,
		);
	}
	assert.equal(metrics.criteria.idleWithinLimit, metrics.idleRatio <= 0.6);
	assert.equal(
		metrics.criteria.passed,
		metrics.criteria.paybackInRange &&
			metrics.criteria.prestigeInRange &&
			metrics.criteria.idleWithinLimit,
	);
});

test("the simulator follows the quest chain instead of only fighting", async () => {
	const content = await loadContent();
	const { state, metrics } = simulate({
		content,
		durationSec: 12 * 3600,
		seed: 5,
	});
	assert.ok((state.counters.gathered.wood ?? 0) >= 20);
	assert.ok(Object.keys(state.counters.crafted).length > 0);
	const first = content.quests[0];
	assert.ok(first);
	assert.equal(questProgress(state, first).status, "claimed");
	const claimed = Object.values(state.quests).filter(
		(quest) => quest.status === "claimed",
	).length;
	assert.ok(claimed >= 3, `квестов закрыто: ${claimed}`);
	assert.ok(metrics.idleRatio <= 0.6);
});

test("a longer run never produces less income than a shorter one", async () => {
	const content = await loadContent();
	const short = simulate({ content, durationSec: 3600, seed: 3 });
	const long = simulate({ content, durationSec: 3 * 3600, seed: 3 });
	assert.ok(long.metrics.totalIncome > short.metrics.totalIncome);
});
