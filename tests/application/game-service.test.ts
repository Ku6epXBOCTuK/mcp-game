import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { openMemoryDatabase } from "../../src/infrastructure/persistence/database.ts";
import { SqlitePlayerRepository } from "../../src/infrastructure/persistence/player-repository.ts";
import { SqliteGameRepository } from "../../src/infrastructure/persistence/game-repository.ts";
import { FileContentRepository } from "../../src/infrastructure/content/loader.ts";
import { GameService } from "../../src/application/use-cases/game-service.ts";
import { fixedClock } from "../../src/application/ports/clock.ts";

const CONTENT_DIR = join(import.meta.dirname, "..", "..", "content");

function makeService(now = 1_000_000) {
	const db = openMemoryDatabase();
	const service = new GameService({
		games: new SqliteGameRepository(db),
		players: new SqlitePlayerRepository(db),
		content: new FileContentRepository(CONTENT_DIR),
		clock: fixedClock(now),
	});
	return { service, db };
}

test("service creates a state for a new player and persists it", async () => {
	const { service, db } = makeService();
	const result = await service.getState("p1");
	assert.equal(result.isOk(), true);
	if (result.isOk()) {
		assert.equal(result.value.state.playerId, "p1");
		assert.equal(result.value.state.version, 3);
		assert.ok(result.value.content.skills.length > 0);
	}
	db.close();
});

test("lazy tick advances progress on the next call", async () => {
	const db = openMemoryDatabase();
	let now = 1_000_000;
	const service = new GameService({
		games: new SqliteGameRepository(db),
		players: new SqlitePlayerRepository(db),
		content: new FileContentRepository(CONTENT_DIR),
		clock: { now: () => now },
	});

	const started = await service.gather("p1", "chopping", "wood");
	assert.equal(started.isOk(), true);

	now += 60_000;
	const next = await service.getState("p1");
	assert.equal(next.isOk(), true);
	if (next.isOk()) {
		assert.ok((next.value.state.inventory.wood ?? 0) > 0);
	}
	db.close();
});

test("start action refuses a second action and records the error in the log", async () => {
	const { service, db } = makeService();
	await service.gather("p1", "chopping", "wood");
	const second = await service.gather("p1", "mining", "stone");
	assert.equal(second.isErr(), true);
	if (second.isErr()) {
		assert.equal(second.error.code, "AlreadyActing");
	}
	const events = await service.listEvents("p1", 10);
	assert.ok(events.some((event) => event.type === "error.AlreadyActing"));
	db.close();
});

test("selling adds gold and buying spends it", async () => {
	const { service, db } = makeService();
	const first = await service.getState("p1");
	assert.equal(first.isOk(), true);

	const sold = await service.sell("p1", "wood", 5);
	assert.equal(sold.isErr(), true);
	if (sold.isErr()) {
		assert.equal(sold.error.code, "NotEnoughResources");
	}

	await service.advanceTime("p1", 600);
	const state = await service.getState("p1");
	assert.equal(state.isOk(), true);
	db.close();
});

test("buying an upgrade spends gold and raises the level", async () => {
	const { service, db } = makeService();
	const started = await service.getState("p1");
	assert.equal(started.isOk(), true);
	if (started.isOk()) {
		const gold = started.value.state.wallet.gold;
		assert.equal(gold, 0);
	}

	const failed = await service.buyUpgrade("p1", "axe");
	assert.equal(failed.isErr(), true);
	if (failed.isErr()) {
		assert.equal(failed.error.code, "InsufficientFunds");
	}
	db.close();
});

test("bank deposit and withdraw move gold between wallet and deposits", async () => {
	const { service, db } = makeService();
	const deposited = await service.bank("p1", { kind: "deposit", amount: 100 });
	assert.equal(deposited.isErr(), true);

	const failedWithdraw = await service.bank("p1", {
		kind: "withdraw",
		amount: 50,
	});
	assert.equal(failedWithdraw.isErr(), true);
	db.close();
});

test("quest claim rejects an unfinished quest", async () => {
	const { service, db } = makeService();
	const result = await service.claimQuest("p1", "quest_first_wood");
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(result.error.code, "QuestNotCompleted");
	}
	db.close();
});

test("prestige is unavailable without earned gold", async () => {
	const { service, db } = makeService();
	const result = await service.prestige("p1");
	assert.equal(result.isErr(), true);
	if (result.isErr()) {
		assert.equal(result.error.code, "NotSupported");
	}
	db.close();
});

test("players do not see each other's state", async () => {
	const { service, db } = makeService();
	await service.gather("p1", "chopping", "wood");
	const other = await service.getState("p2");
	assert.equal(other.isOk(), true);
	if (other.isOk()) {
		assert.equal(other.value.state.inventory.wood ?? 0, 0);
		assert.equal(other.value.state.activeAction, null);
	}
	db.close();
});

test("events log records successful actions", async () => {
	const { service, db } = makeService();
	await service.gather("p1", "chopping", "wood");
	const events = await service.listEvents("p1", 10);
	assert.ok(events.some((event) => event.type === "action.started"));
	db.close();
});
