import { upgradeCost, xpToNext } from "../shared/curves.ts";
import {
	type Result,
	ok,
	err,
	alreadyActing,
	creditLimitExceeded,
	insufficientFunds,
	itemUnknown,
	noActiveAction,
	notEnoughResources,
	skillTooLow,
	unknownCommand,
	upgradeMaxLevel,
	zoneLocked,
} from "../shared/result.ts";
import type { GameContent } from "../content/types.ts";
import { creditLimit } from "./bank.ts";
import {
	DEFAULT_COMBAT_POLICY,
	forecastCombat,
	playerDpsFor,
} from "./combat.ts";
import { applyBuffItem, buffDamageMultiplier, buffEffect } from "./buffs.ts";
import { healToFull, maxHpFor } from "./health.ts";
import { questCompleted } from "./quests.ts";
import type {
	ActiveAction,
	CombatBuff,
	CraftAction,
	FightAction,
	GameState,
	GatherAction,
	ItemId,
	MonsterId,
	RecipeId,
	SkillId,
	UpgradeId,
} from "./types.ts";

import type { DomainError } from "../shared/errors.ts";

export type StartActionCommand =
	| { kind: "gather"; skill: SkillId; targetId: string }
	| { kind: "craft"; recipeId: RecipeId }
	| { kind: "fight"; monsterId: MonsterId };

export const MAX_PAUSED_ACTIONS = 3;

function pausedOf(state: GameState): ActiveAction[] {
	return state.pausedActions ?? [];
}

function findPaused(state: GameState, key: string): ActiveAction | undefined {
	return pausedOf(state).find((action) => describeAction(action) === key);
}

// NOTE: the progress of a paused action is kept, so switching between jobs
// costs nothing but the time to decide. Only one action ever runs.
function resumePaused(
	state: GameState,
	fresh: ActiveAction,
): { action: ActiveAction; pausedActions: ActiveAction[] } {
	const key = describeAction(fresh);
	const paused = findPaused(state, key);
	const pausedActions = pausedOf(state).filter(
		(action) => describeAction(action) !== key,
	);
	if (!paused) return { action: fresh, pausedActions };
	if (fresh.kind === "fight" && paused.kind === "fight") {
		return {
			action: {
				...fresh,
				monsterHpLeft: paused.monsterHpLeft,
				monsterHitInSec: paused.monsterHitInSec,
				damageMultiplier: paused.damageMultiplier ?? 1,
			},
			pausedActions,
		};
	}
	if (fresh.kind === "craft" && paused.kind === "craft") {
		return { action: { ...fresh, progress: paused.progress }, pausedActions };
	}
	if (fresh.kind === "gather" && paused.kind === "gather") {
		return { action: { ...fresh, progress: paused.progress }, pausedActions };
	}
	return { action: fresh, pausedActions };
}

export function startAction(
	state: GameState,
	content: GameContent,
	command: StartActionCommand,
	now: number,
): Result<GameState, DomainError> {
	if (state.activeAction) {
		return alreadyActing(describeAction(state.activeAction));
	}

	if (command.kind === "gather") {
		const item = content.items.find((entry) => entry.id === command.targetId);
		if (!item) return itemUnknown(command.targetId);
		if (!item.skill) {
			return err({
				code: "NotSupported",
				message: `Добывать нечего: "${item.id}" не является сырьём.`,
				feature: `gather:${item.id}`,
			});
		}
		if (item.skill !== command.skill) {
			return err({
				code: "NotSupported",
				message: `"${item.id}" добывается скиллом "${item.skill}", а не "${command.skill}".`,
				feature: `gather:${item.id}`,
			});
		}
		const requiredLevel = item.skillLevel ?? 1;
		const level = state.skills[item.skill]?.level ?? 0;
		if (level < requiredLevel) {
			return skillTooLow(item.skill, requiredLevel, level);
		}
		const action: GatherAction = {
			kind: "gather",
			skill: command.skill,
			targetId: command.targetId,
			startedAt: now,
			endsAt: now,
			progress: 0,
		};
		const resumed = resumePaused(state, action);
		return ok({
			...state,
			pausedActions: resumed.pausedActions,
			activeAction: resumed.action,
			updatedAt: now,
		});
	}

	if (command.kind === "craft") {
		const recipe = content.recipes.find(
			(entry) => entry.id === command.recipeId,
		);
		if (!recipe) {
			return err({
				code: "RecipeUnknown",
				message: `Неизвестный рецепт "${command.recipeId}".`,
				recipeId: command.recipeId,
			});
		}
		const level = state.skills[recipe.skill]?.level ?? 0;
		if (level < recipe.skillLevel) {
			return skillTooLow(recipe.skill, recipe.skillLevel, level);
		}
		for (const input of recipe.inputs) {
			const available = state.inventory[input.item] ?? 0;
			if (available < input.qty) {
				return notEnoughResources(input.item, input.qty, available);
			}
		}
		const action: CraftAction = {
			kind: "craft",
			skill: recipe.skill,
			targetId: recipe.id,
			startedAt: now,
			endsAt: now + recipe.timeSec,
			progress: 0,
		};
		const resumed = resumePaused(state, action);
		return ok({
			...state,
			pausedActions: resumed.pausedActions,
			activeAction: resumed.action,
			updatedAt: now,
		});
	}

	const monster = content.monsters.find(
		(entry) => entry.id === command.monsterId,
	);
	if (!monster) {
		return err({
			code: "MonsterUnknown",
			message: `Неизвестный монстр "${command.monsterId}".`,
			monsterId: command.monsterId,
		});
	}
	const zone = content.zones.find((entry) => entry.id === monster.zone);
	if (zone) {
		const unlock = zone.unlock;
		if (unlock.kind === "quest") {
			const quest = content.quests.find((entry) => entry.id === unlock.quest);
			const status = quest ? state.quests[quest.id]?.status : undefined;
			const done =
				status === "completed" ||
				status === "claimed" ||
				(quest ? questCompleted(state, quest) : false);
			if (!done) {
				return zoneLocked(zone.id, `нужен квест "${unlock.quest}"`);
			}
		}
		if (unlock.kind === "skillLevel") {
			const level = state.skills[unlock.skill]?.level ?? 0;
			if (level < unlock.level) {
				return zoneLocked(
					zone.id,
					`нужен скилл "${unlock.skill}" уровня ${unlock.level} (есть ${level})`,
				);
			}
		}
	}
	const policy = state.combatPolicy ?? DEFAULT_COMBAT_POLICY;
	const baseDps = playerDpsFor(state, content);
	const maxHp = maxHpFor(state, content);
	const canWinWith = (dps: number, hp: number): boolean =>
		forecastCombat({
			monster,
			monsterHpLeft: monster.hp,
			nextMonsterHitInSec: monster.attackInterval,
			playerDps: dps,
			playerHp: hp,
			playerMaxHp: maxHp,
		}).canWin;

	let next = state;
	let buffs: CombatBuff[] = [...(state.combatBuffs ?? [])];
	const pausedFight = findPaused(state, `fight:${monster.id}`);
	if (!pausedFight && policy.strengthPotionWhenLosing) {
		const current = baseDps * buffDamageMultiplier(buffs);
		if (!canWinWith(current, state.health.hp)) {
			for (const itemId of ["elixir", "potion_strength"]) {
				if ((state.inventory[itemId] ?? 0) <= 0) continue;
				const effect = buffEffect(content, itemId);
				if (!effect) continue;
				const candidate: CombatBuff[] = [
					...buffs,
					{ id: itemId, damageMultiplier: effect.damageMultiplier },
				];
				const withItem = applyBuffItem(next, content, itemId);
				const hp = itemId === "elixir" ? maxHp : withItem.health.hp;
				if (!canWinWith(baseDps * buffDamageMultiplier(candidate), hp)) {
					continue;
				}
				next = itemId === "elixir" ? healToFull(withItem, content) : withItem;
				buffs = candidate;
				break;
			}
		}
	}
	const action: FightAction =
		pausedFight && pausedFight.kind === "fight"
			? {
					kind: "fight",
					skill: "combat",
					targetId: monster.id,
					startedAt: now,
					endsAt: now,
					monsterHpLeft: pausedFight.monsterHpLeft,
					monsterHitInSec: pausedFight.monsterHitInSec,
					damageMultiplier: pausedFight.damageMultiplier ?? 1,
				}
			: {
					kind: "fight",
					skill: "combat",
					targetId: monster.id,
					startedAt: now,
					endsAt: now,
					monsterHpLeft: monster.hp,
					monsterHitInSec:
						monster.attackInterval > 0 ? monster.attackInterval : Infinity,
					damageMultiplier: buffDamageMultiplier(buffs),
				};
	const pausedActions = pausedOf(state).filter(
		(entry) => describeAction(entry) !== `fight:${monster.id}`,
	);
	return ok({
		...next,
		combatBuffs: pausedFight ? (state.combatBuffs ?? []) : [],
		pausedActions,
		activeAction: action,
		updatedAt: now,
	});
}

export function cancelAction(
	state: GameState,
	now: number,
): Result<GameState, DomainError> {
	if (!state.activeAction) return noActiveAction();
	const paused = [...pausedOf(state), state.activeAction];
	const trimmed =
		paused.length > MAX_PAUSED_ACTIONS
			? paused.slice(paused.length - MAX_PAUSED_ACTIONS)
			: paused;
	return ok({
		...state,
		activeAction: null,
		pausedActions: trimmed,
		updatedAt: now,
	});
}

export function discardPausedActions(
	state: GameState,
	now: number,
	targetId?: string,
): GameState {
	const kept = targetId
		? pausedOf(state).filter((action) => action.targetId !== targetId)
		: [];
	return { ...state, pausedActions: kept, updatedAt: now };
}

export function describeAction(action: ActiveAction): string {
	return `${action.kind}:${action.targetId}`;
}

export function upgradePrice(
	content: GameContent,
	upgradeId: UpgradeId,
	level: number,
): number {
	const upgrade = content.upgrades.find((entry) => entry.id === upgradeId);
	if (!upgrade) return 0;
	const growth = content.balance.costGrowth[upgradeId] ?? upgrade.costGrowth;
	const scale = content.balance.upgradeCostScale?.[upgradeId] ?? 1;
	return Math.ceil(upgradeCost(upgrade.costBase * scale, growth, level));
}

export function buyUpgrade(
	state: GameState,
	content: GameContent,
	upgradeId: UpgradeId,
	now: number,
): Result<GameState, DomainError> {
	const upgrade = content.upgrades.find((entry) => entry.id === upgradeId);
	if (!upgrade) {
		return err({
			code: "UpgradeLocked",
			message: `Неизвестный апгрейд "${upgradeId}".`,
			upgradeId,
			reason: "unknown",
		});
	}
	const level = state.upgrades[upgradeId] ?? 0;
	if (level >= upgrade.maxLevel) {
		return upgradeMaxLevel(upgradeId, upgrade.maxLevel);
	}
	const cost = upgradePrice(content, upgradeId, level);
	if (state.wallet.gold < cost) {
		return insufficientFunds(cost, state.wallet.gold);
	}
	return ok({
		...state,
		wallet: { ...state.wallet, gold: state.wallet.gold - cost },
		upgrades: { ...state.upgrades, [upgradeId]: level + 1 },
		updatedAt: now,
	});
}

export type BankOperation =
	| { kind: "deposit"; amount: number }
	| { kind: "withdraw"; amount: number }
	| { kind: "credit"; amount: number }
	| { kind: "repay"; amount: number };

export function bankOperation(
	state: GameState,
	content: GameContent,
	operation: BankOperation,
	now: number,
): Result<GameState, DomainError> {
	const amount = Math.floor(operation.amount);
	if (!Number.isFinite(amount) || amount <= 0) {
		return unknownCommand(`bank:${operation.kind}`);
	}

	if (operation.kind === "deposit") {
		if (state.wallet.gold < amount) {
			return insufficientFunds(amount, state.wallet.gold);
		}
		return ok({
			...state,
			wallet: { ...state.wallet, gold: state.wallet.gold - amount },
			bank: {
				...state.bank,
				deposits: state.bank.deposits + amount,
			},
			updatedAt: now,
		});
	}

	if (operation.kind === "withdraw") {
		if (state.bank.deposits < amount) {
			return insufficientFunds(amount, state.bank.deposits);
		}
		return ok({
			...state,
			wallet: { ...state.wallet, gold: state.wallet.gold + amount },
			bank: { ...state.bank, deposits: state.bank.deposits - amount },
			updatedAt: now,
		});
	}

	if (operation.kind === "credit") {
		const limit = creditLimit(state, content);
		const available = Math.max(0, limit - state.bank.credit);
		if (limit <= 0) {
			return creditLimitExceeded(0, amount);
		}
		if (amount > available) {
			return creditLimitExceeded(limit, state.bank.credit + amount);
		}
		return ok({
			...state,
			wallet: { ...state.wallet, gold: state.wallet.gold + amount },
			bank: { ...state.bank, credit: state.bank.credit + amount },
			updatedAt: now,
		});
	}

	const debt = state.bank.credit;
	if (debt <= 0) {
		return err({
			code: "NotSupported",
			message: "Кредит не выдан: погашать нечего.",
			feature: "bank:repay",
		});
	}
	const required = Math.min(amount, debt);
	if (state.wallet.gold < required) {
		return insufficientFunds(required, state.wallet.gold);
	}
	return ok({
		...state,
		wallet: { ...state.wallet, gold: state.wallet.gold - required },
		bank: { ...state.bank, credit: debt - required },
		updatedAt: now,
	});
}

export function xpToNextLevel(
	state: GameState,
	skill: SkillId,
	balanceXpBase: number,
	balanceXpExponent: number,
): number {
	const current = state.skills[skill];
	if (!current) return 0;
	return xpToNext(current.level, balanceXpBase, balanceXpExponent);
}

export function itemQuantity(state: GameState, itemId: ItemId): number {
	return state.inventory[itemId] ?? 0;
}
