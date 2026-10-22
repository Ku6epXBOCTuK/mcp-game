import { test } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FileContentRepository } from "../../src/infrastructure/content/loader.ts";
import { createInitialState } from "../../src/domain/game/state.ts";
import { maxHpFor } from "../../src/domain/game/health.ts";
import { tick } from "../../src/domain/game/tick.ts";
import type { GameContent } from "../../src/domain/content/types.ts";
import type { GameState } from "../../src/domain/game/types.ts";

const contentDir = join(import.meta.dirname, "..", "..", "content");

const MAX_COMBAT_LEVEL = 40;
const POLL_INTERVALS = [30, 60];

async function loadContent(): Promise<GameContent> {
	const repo = new FileContentRepository(contentDir);
	const result = await repo.load();
	assert.equal(result.isOk(), true);
	if (result.isErr()) throw new Error("content must load");
	return result.value;
}

function startFight(
	content: GameContent,
	monsterId: string,
	combatLevel: number,
): GameState {
	let state = createInitialState("p1", 7, 1000);
	state = {
		...state,
		skills: {
			...state.skills,
			combat: { id: "combat", level: combatLevel, xp: 0 },
		},
	};
	const maxHp = maxHpFor(state, content);
	return {
		...state,
		health: { hp: maxHp, maxHp },
		activeAction: {
			kind: "fight",
			skill: "combat",
			targetId: monsterId,
			startedAt: 1000,
			endsAt: 1000,
			progress: 0,
		},
	};
}

function fightOutcome(
	content: GameContent,
	monsterId: string,
	combatLevel: number,
	pollSec: number,
): "win" | "dead" {
	let state = startFight(content, monsterId, combatLevel);
	let clock = 1000;
	for (let step = 0; step < 400; step += 1) {
		clock += pollSec;
		const killedBefore = state.counters.killed[monsterId] ?? 0;
		state = tick(state, { content, now: clock });
		if ((state.counters.killed[monsterId] ?? 0) > killedBefore) return "win";
		if (!state.activeAction) return "dead";
	}
	return "dead";
}

function levelThatWins(
	content: GameContent,
	monsterId: string,
	pollSec: number,
): number | null {
	for (let level = 1; level <= MAX_COMBAT_LEVEL; level += 1) {
		if (fightOutcome(content, monsterId, level, pollSec) === "win")
			return level;
	}
	return null;
}

test("every monster is killable at a reachable combat level", async () => {
	const content = await loadContent();
	for (const pollSec of POLL_INTERVALS) {
		for (const monster of content.monsters) {
			const level = levelThatWins(content, monster.id, pollSec);
			assert.ok(
				level !== null,
				`${monster.id} is not killable at combat ${MAX_COMBAT_LEVEL} with a ${pollSec}s poll`,
			);
		}
	}
});

test("the health pool grows fast enough to cover the late content", async () => {
	const content = await loadContent();
	const dragon = content.monsters.find((entry) => entry.id === "dragon");
	assert.ok(dragon);
	const level = levelThatWins(content, dragon.id, 60);
	assert.ok(level !== null);
	const state = createInitialState("p1", 7, 1000);
	const scaled: GameState = {
		...state,
		skills: { ...state.skills, combat: { id: "combat", level, xp: 0 } },
	};
	const maxHp = maxHpFor(scaled, content);
	const burst = Math.floor(60 / dragon.attackInterval) * dragon.damage;
	assert.ok(
		maxHp >= burst,
		`max hp ${maxHp} must survive one poll burst of ${burst}`,
	);
});

test("a potion restores a meaningful share of the health pool", async () => {
	const content = await loadContent();
	const percent = content.balance.potionHealthHealPercent ?? 0.5;
	assert.ok(percent >= 0.3, "a potion must heal at least 30% of the pool");
});
