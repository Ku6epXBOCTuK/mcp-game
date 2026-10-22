import type { GameContent } from "../content/types.ts";
import type { GameState } from "./types.ts";

export const DEFAULT_BANK_INTEREST_PER_HOUR = 0.15;
export const DEFAULT_BANK_REPAY_SHARE = 0.5;

export function creditLimit(state: GameState, content: GameContent): number {
	const level = state.upgrades.bank ?? 0;
	const perLevel = content.balance.bankCreditLimitPerLevel ?? 0;
	return level * perLevel;
}

export function availableCredit(
	state: GameState,
	content: GameContent,
): number {
	return Math.max(0, creditLimit(state, content) - state.bank.credit);
}

export function accrueInterest(
	state: GameState,
	content: GameContent,
	elapsed: number,
): GameState {
	const rate =
		content.balance.bankInterestPerHour ?? DEFAULT_BANK_INTEREST_PER_HOUR;
	const debt = state.bank.credit;
	if (debt <= 0 || rate <= 0 || elapsed <= 0) return state;
	const interest = debt * rate * (elapsed / 3600);
	return { ...state, bank: { ...state.bank, credit: debt + interest } };
}

export function applyGoldIncome(
	state: GameState,
	content: GameContent,
	gold: number,
): GameState {
	if (gold <= 0) return state;
	const debt = state.bank.credit;
	const share =
		content.balance.bankRepayShareOfIncome ?? DEFAULT_BANK_REPAY_SHARE;
	if (debt <= 0 || share <= 0) {
		return {
			...state,
			wallet: { ...state.wallet, gold: state.wallet.gold + gold },
		};
	}
	const repaid = Math.min(debt, gold * share);
	return {
		...state,
		wallet: { ...state.wallet, gold: state.wallet.gold + (gold - repaid) },
		bank: { ...state.bank, credit: debt - repaid },
	};
}
