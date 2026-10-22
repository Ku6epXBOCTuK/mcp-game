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
			monsterHpLeft:
				content.monsters.find((entry) => entry.id === monsterId)?.hp ?? 1,
			monsterHitInSec:
				content.monsters.find((entry) => entry.id === monsterId)
					?.attackInterval ?? 1,
		},
	};
}

type FightRun = {
	outcome: "win" | "dead";
	hp: number;
	maxHp: number;
};

function runFight(
	content: GameContent,
	monsterId: string,
	combatLevel: number,
	pollSec: number,
): FightRun {
	let state = startFight(content, monsterId, combatLevel);
	let clock = 1000;
	for (let step = 0; step < 400; step += 1) {
		clock += pollSec;
		const killedBefore = state.counters.killed[monsterId] ?? 0;
		state = tick(state, { content, now: clock });
		if ((state.counters.killed[monsterId] ?? 0) > killedBefore) {
			return {
				outcome: "win",
				hp: state.health.hp,
				maxHp: state.health.maxHp,
			};
		}
		if (!state.activeAction) {
			return {
				outcome: "dead",
				hp: state.health.hp,
				maxHp: state.health.maxHp,
			};
		}
	}
	return {
		outcome: "dead",
		hp: state.health.hp,
		maxHp: state.health.maxHp,
	};
}

function fightOutcome(
	content: GameContent,
	monsterId: string,
	combatLevel: number,
	pollSec: number,
): "win" | "dead" {
	return runFight(content, monsterId, combatLevel, pollSec).outcome;
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

test("the fight outcome does not depend on the poll interval", async () => {
	const content = await loadContent();
	for (const monster of content.monsters) {
		const minimal = levelThatWins(content, monster.id, 1);
		assert.ok(minimal !== null, `${monster.id} must be killable`);
		for (const level of [Math.max(1, minimal - 1), minimal]) {
			const reference = fightOutcome(content, monster.id, level, 1);
			for (const pollSec of [5, 30, 60, 300]) {
				assert.equal(
					fightOutcome(content, monster.id, level, pollSec),
					reference,
					`${monster.id} at combat ${level} changed with a ${pollSec}s poll`,
				);
			}
		}
	}
});

test("the minimal winning level leaves the player alive", async () => {
	const content = await loadContent();
	for (const monster of content.monsters) {
		const level = levelThatWins(content, monster.id, 1);
		assert.ok(level !== null, `${monster.id} must be killable`);
		const run = runFight(content, monster.id, level, 1);
		assert.equal(run.outcome, "win");
		assert.ok(run.hp > 0, `${monster.id} must be survived at combat ${level}`);
	}
});

test("a comfortable fight against the late content keeps a real margin", async () => {
	const content = await loadContent();
	const dragon = content.monsters.find((entry) => entry.id === "dragon");
	assert.ok(dragon);
	const incoming = dragon.damage / dragon.attackInterval;
	const level = Math.ceil(
		(incoming * 1.3 - content.balance.playerDamageBase) /
			content.balance.playerDamagePerLevel,
	);
	const run = runFight(content, dragon.id, level, 60);
	assert.equal(run.outcome, "win");
	assert.ok(
		run.hp > run.maxHp * 0.3,
		`hp ${run.hp} of ${run.maxHp} must survive the dragon fight`,
	);
});

function runWindow(
	content: GameContent,
	monsterId: string,
	combatLevel: number,
	stepSec: number,
	windowSec: number,
) {
	let state = startFight(content, monsterId, combatLevel);
	let clock = 1000;
	const end = 1000 + windowSec;
	while (clock < end) {
		clock = Math.min(clock + stepSec, end);
		state = tick(state, { content, now: clock });
	}
	return {
		hp: state.health.hp,
		deaths: state.stats.deaths,
		killed: state.counters.killed[monsterId] ?? 0,
		xp: state.skills.combat?.xp ?? 0,
		level: state.skills.combat?.level ?? 1,
		inventory: state.inventory,
		action: state.activeAction?.kind ?? null,
	};
}

test("the whole afternoon of offline play does not depend on the poll interval", async () => {
	const content = await loadContent();
	const level = levelThatWins(content, "dragon", 1);
	assert.ok(level !== null, "the dragon must be killable");
	const windowSec = content.balance.offlineCapSec;
	const reference = runWindow(content, "dragon", level, 1, windowSec);
	for (const stepSec of [60, 600, windowSec]) {
		assert.deepEqual(
			runWindow(content, "dragon", level, stepSec, windowSec),
			reference,
			`the dragon fight changed with a ${stepSec}s poll`,
		);
	}
});

test("a potion restores a meaningful share of the health pool", async () => {
	const content = await loadContent();
	const percent = content.balance.potionHealthHealPercent ?? 0.5;
	assert.ok(percent >= 0.3, "a potion must heal at least 30% of the pool");
});
