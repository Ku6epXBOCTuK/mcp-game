import type { GameContent, MonsterContent } from "../content/types.ts";
import type { CombatPolicy, GameState } from "./types.ts";

export const DEFAULT_COMBAT_POLICY: CombatPolicy = {
	potionAtHpPercent: null,
	fleeAtHpPercent: null,
	autoRepeat: false,
};

export type CombatState = {
	monsterHpLeft: number;
	monsterHitInSec: number;
};

export type CombatOutcome = "ongoing" | "victory" | "defeat" | "fled";

export type CombatInput = {
	combat: CombatState;
	elapsed: number;
	monster: MonsterContent;
	playerDps: number;
	playerHp: number;
	playerMaxHp: number;
	potionHeal: number;
	potionsAvailable: number;
	policy: CombatPolicy;
};

export type CombatResult = {
	outcome: CombatOutcome;
	combat: CombatState;
	playerHp: number;
	spentSec: number;
	potionsUsed: number;
};

export type CombatForecast = {
	monsterId: string;
	monsterName: string;
	monsterHpLeft: number;
	monsterDamage: number;
	monsterAttackInterval: number;
	playerHp: number;
	playerMaxHp: number;
	playerDps: number;
	incomingDps: number;
	nextMonsterHitInSec: number;
	timeToKillSec: number | null;
	timeToDieSec: number | null;
	canWin: boolean;
};

export function startCombat(monster: MonsterContent): CombatState {
	return {
		monsterHpLeft: monster.hp,
		monsterHitInSec:
			monster.attackInterval > 0 ? monster.attackInterval : Infinity,
	};
}

// NOTE: the forecast ignores temporary event skill bonuses, so it stays a
// conservative plan: the real damage is never lower than the forecast.
export function playerDpsFor(state: GameState, content: GameContent): number {
	const level = state.skills.combat?.level ?? 1;
	return (
		content.balance.playerDamageBase +
		content.balance.playerDamagePerLevel * level
	);
}

export type CombatPolicyPatch = {
	potionAtHpPercent?: number | null | undefined;
	fleeAtHpPercent?: number | null | undefined;
	autoRepeat?: boolean | undefined;
};

function clampPercent(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

export function updateCombatPolicy(
	state: GameState,
	patch: CombatPolicyPatch,
	now: number,
): GameState {
	const current = state.combatPolicy ?? DEFAULT_COMBAT_POLICY;
	const next: CombatPolicy = {
		potionAtHpPercent:
			patch.potionAtHpPercent === undefined
				? current.potionAtHpPercent
				: patch.potionAtHpPercent === null
					? null
					: clampPercent(patch.potionAtHpPercent),
		fleeAtHpPercent:
			patch.fleeAtHpPercent === undefined
				? current.fleeAtHpPercent
				: patch.fleeAtHpPercent === null
					? null
					: clampPercent(patch.fleeAtHpPercent),
		autoRepeat: patch.autoRepeat ?? current.autoRepeat,
	};
	return { ...state, combatPolicy: next, updatedAt: now };
}

// NOTE: the fight is resolved as a timeline of hits, so the outcome does not
// depend on how often the caller polls: a 12h tick and 1s ticks agree.
export function advanceCombat(input: CombatInput): CombatResult {
	const { monster, policy } = input;
	const interval =
		monster.attackInterval > 0 ? monster.attackInterval : Infinity;
	const elapsed = Math.max(0, input.elapsed);
	let remaining = elapsed;
	let hp = input.playerHp;
	let monsterHp = input.combat.monsterHpLeft;
	let hitIn =
		input.combat.monsterHitInSec === Infinity
			? Infinity
			: Math.max(0, input.combat.monsterHitInSec);
	let potionsLeft = input.potionsAvailable;
	let potionsUsed = 0;

	const potionThreshold =
		policy.potionAtHpPercent === null
			? null
			: (input.playerMaxHp * policy.potionAtHpPercent) / 100;
	const fleeThreshold =
		policy.fleeAtHpPercent === null
			? null
			: (input.playerMaxHp * policy.fleeAtHpPercent) / 100;

	const ongoing = (): CombatResult => ({
		outcome: "ongoing",
		combat: { monsterHpLeft: monsterHp, monsterHitInSec: hitIn },
		playerHp: hp,
		spentSec: elapsed,
		potionsUsed,
	});

	while (remaining > 0) {
		const timeToKill =
			input.playerDps > 0 ? monsterHp / input.playerDps : Infinity;
		if (Number.isFinite(timeToKill) && timeToKill <= hitIn) {
			return {
				outcome: "victory",
				combat: { monsterHpLeft: 0, monsterHitInSec: hitIn },
				playerHp: hp,
				spentSec: elapsed - remaining + timeToKill,
				potionsUsed,
			};
		}
		if (hitIn > remaining) {
			monsterHp = Math.max(0, monsterHp - input.playerDps * remaining);
			hitIn = Number.isFinite(hitIn) ? hitIn - remaining : hitIn;
			return ongoing();
		}
		hp -= monster.damage;
		remaining -= hitIn;
		monsterHp = Math.max(0, monsterHp - input.playerDps * hitIn);
		hitIn = interval;
		if (fleeThreshold !== null && hp > 0 && hp <= fleeThreshold) {
			return {
				outcome: "fled",
				combat: { monsterHpLeft: monsterHp, monsterHitInSec: hitIn },
				playerHp: hp,
				spentSec: elapsed - remaining,
				potionsUsed,
			};
		}
		if (hp <= 0) {
			return {
				outcome: "defeat",
				combat: { monsterHpLeft: monsterHp, monsterHitInSec: hitIn },
				playerHp: 0,
				spentSec: elapsed - remaining,
				potionsUsed,
			};
		}
		if (
			potionThreshold !== null &&
			potionsLeft > 0 &&
			hp <= potionThreshold &&
			input.potionHeal > 0
		) {
			hp = Math.min(input.playerMaxHp, hp + input.potionHeal);
			potionsLeft -= 1;
			potionsUsed += 1;
		}
	}
	return ongoing();
}

export function forecastCombat(params: {
	monster: MonsterContent;
	monsterHpLeft: number;
	nextMonsterHitInSec: number;
	playerDps: number;
	playerHp: number;
	playerMaxHp: number;
}): CombatForecast {
	const { monster } = params;
	const interval = monster.attackInterval;
	const timeToKillSec =
		params.playerDps > 0 ? params.monsterHpLeft / params.playerDps : null;
	let timeToDieSec: number | null = null;
	if (monster.damage > 0 && params.playerHp > 0) {
		const hitsToDie = Math.ceil(params.playerHp / monster.damage);
		timeToDieSec = params.nextMonsterHitInSec + (hitsToDie - 1) * interval;
	}
	return {
		monsterId: monster.id,
		monsterName: monster.name,
		monsterHpLeft: params.monsterHpLeft,
		monsterDamage: monster.damage,
		monsterAttackInterval: interval,
		playerHp: params.playerHp,
		playerMaxHp: params.playerMaxHp,
		playerDps: params.playerDps,
		incomingDps: interval > 0 ? monster.damage / interval : 0,
		nextMonsterHitInSec: params.nextMonsterHitInSec,
		timeToKillSec,
		timeToDieSec,
		canWin:
			timeToKillSec !== null &&
			(timeToDieSec === null || timeToKillSec <= timeToDieSec),
	};
}
