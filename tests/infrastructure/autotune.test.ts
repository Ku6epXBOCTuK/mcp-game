import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FileContentRepository } from "../../src/infrastructure/content/loader.ts";
import {
	autotune,
	scaledContent,
	scoreMetrics,
} from "../../src/infrastructure/sim/autotune.ts";

const contentDir = join(import.meta.dirname, "..", "..", "content");

async function loadContent() {
	const repo = new FileContentRepository(contentDir);
	const result = await repo.load();
	assert.equal(result.isOk(), true);
	if (result.isErr()) throw new Error("content must load");
	return result.value;
}

test("scaled content multiplies rates and costs", async () => {
	const content = await loadContent();
	const scaled = scaledContent(content, 2, 0.5, 500);
	assert.equal(
		scaled.balance.rateBase.chopping,
		(content.balance.rateBase.chopping ?? 0) * 2,
	);
	assert.equal(scaled.balance.upgradeCostScale?.axe, 0.5);
	assert.equal(scaled.balance.prestigeGoldThreshold, 500);
	const fresh = await loadContent();
	assert.equal(
		content.balance.prestigeGoldThreshold,
		fresh.balance.prestigeGoldThreshold,
	);
});

test("autotune returns a balance that passes the criteria", async () => {
	const content = await loadContent();
	const result = autotune({
		content,
		durationSec: 6 * 3600,
		seed: 7,
	});
	assert.ok(result.trials > 0);
	assert.ok((result.balance.rateBase.chopping ?? 0) > 0);
	assert.ok((result.balance.prestigeGoldThreshold ?? 0) > 0);
	assert.ok(result.changes.length > 0);
	assert.equal(result.metrics.criteria.passed, result.score === 0);
});

test("autotune is deterministic", async () => {
	const content = await loadContent();
	const first = autotune({ content, durationSec: 3 * 3600, seed: 4 });
	const second = autotune({ content, durationSec: 3 * 3600, seed: 4 });
	assert.equal(first.score, second.score);
	assert.deepEqual(first.changes, second.changes);
	assert.equal(
		first.balance.prestigeGoldThreshold,
		second.balance.prestigeGoldThreshold,
	);
});

test("score penalises metrics outside the target windows", async () => {
	const content = await loadContent();
	const { metrics } = autotune({
		content,
		durationSec: 3 * 3600,
		seed: 7,
	});
	const perfect = scoreMetrics(metrics);
	const broken = scoreMetrics({
		...metrics,
		medianPaybackSec: 60 * 60,
		timeToPrestigeSec: 60,
		idleRatio: 0.9,
		bottlenecks: ["axe", "pickaxe"],
	});
	assert.ok(broken > perfect);
});
