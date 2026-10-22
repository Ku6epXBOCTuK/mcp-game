import { err, ok, type Result } from "neverthrow";
import type { DomainError, DomainErrorCode } from "./errors.ts";
import type {
	ItemId,
	QuestId,
	RecipeId,
	SkillId,
	UpgradeId,
	ZoneId,
} from "../game/types.ts";

export type { Result };

export function notEnoughResources(
	item: ItemId,
	required: number,
	available: number,
): Result<never, DomainError> {
	return err({
		code: "NotEnoughResources",
		message: `Не хватает ресурса "${item}": нужно ${required}, есть ${available}.`,
		item,
		required,
		available,
	});
}

export function skillTooLow(
	skill: SkillId,
	requiredLevel: number,
	actualLevel: number,
): Result<never, DomainError> {
	return err({
		code: "SkillTooLow",
		message: `Недостаточный уровень скилла "${skill}": нужно ${requiredLevel}, есть ${actualLevel}.`,
		skill,
		requiredLevel,
		actualLevel,
	});
}

export function recipeUnknown(recipeId: RecipeId): Result<never, DomainError> {
	return err({
		code: "RecipeUnknown",
		message: `Неизвестный рецепт "${recipeId}".`,
		recipeId,
	});
}

export function itemUnknown(itemId: ItemId): Result<never, DomainError> {
	return err({
		code: "ItemUnknown",
		message: `Неизвестный предмет "${itemId}".`,
		itemId,
	});
}

export function upgradeLocked(
	upgradeId: UpgradeId,
	reason: string,
): Result<never, DomainError> {
	return err({
		code: "UpgradeLocked",
		message: `Апгрейд "${upgradeId}" заблокирован: ${reason}.`,
		upgradeId,
		reason,
	});
}

export function upgradeMaxLevel(
	upgradeId: UpgradeId,
	maxLevel: number,
): Result<never, DomainError> {
	return err({
		code: "UpgradeMaxLevel",
		message: `Апгрейд "${upgradeId}" уже на максимальном уровне (${maxLevel}).`,
		upgradeId,
		maxLevel,
	});
}

export function alreadyActing(
	currentAction: string,
): Result<never, DomainError> {
	return err({
		code: "AlreadyActing",
		message: `Уже выполняется действие "${currentAction}". Сначала отмените или дождитесь завершения.`,
		currentAction,
	});
}

export function noActiveAction(): Result<never, DomainError> {
	return err({
		code: "NoActiveAction",
		message: "Нет активного действия.",
	});
}

export function insufficientFunds(
	required: number,
	available: number,
): Result<never, DomainError> {
	return err({
		code: "InsufficientFunds",
		message: `Недостаточно золота: нужно ${required}, есть ${available}.`,
		required,
		available,
	});
}

export function zoneLocked(
	zoneId: ZoneId,
	reason: string,
): Result<never, DomainError> {
	return err({
		code: "ZoneLocked",
		message: `Зона "${zoneId}" заблокирована: ${reason}.`,
		zoneId,
		reason,
	});
}

export function monsterUnknown(monsterId: string): Result<never, DomainError> {
	return err({
		code: "MonsterUnknown",
		message: `Неизвестный монстр "${monsterId}".`,
		monsterId,
	});
}

export function questNotCompleted(
	questId: QuestId,
): Result<never, DomainError> {
	return err({
		code: "QuestNotCompleted",
		message: `Квест "${questId}" ещё не выполнен.`,
		questId,
	});
}

export function questAlreadyClaimed(
	questId: QuestId,
): Result<never, DomainError> {
	return err({
		code: "QuestAlreadyClaimed",
		message: `Награда за квест "${questId}" уже получена.`,
		questId,
	});
}

export function unknownCommand(command: string): Result<never, DomainError> {
	return err({
		code: "UnknownCommand",
		message: `Неизвестная команда "${command}".`,
		command,
	});
}

export function contentInvalidError(
	path: string,
	id: string,
	detail: string,
): DomainError {
	return {
		code: "ContentInvalid",
		message: `Контент "${path}" (id "${id}") невалиден: ${detail}.`,
		path,
		id,
		detail,
	};
}

export function contentInvalid(
	path: string,
	id: string,
	detail: string,
): Result<never, DomainError> {
	return err(contentInvalidError(path, id, detail));
}

export function notSupported(feature: string): Result<never, DomainError> {
	return err({
		code: "NotSupported",
		message: `Функция "${feature}" не поддерживается.`,
		feature,
	});
}

export function isDomainError(value: unknown): value is DomainError {
	if (typeof value !== "object" || value === null) return false;
	const code = (value as { code?: unknown }).code;
	return typeof code === "string" && code.length > 0;
}

export function toMessage(error: DomainError): string {
	return error.message;
}

export function describeError(error: DomainError): {
	code: DomainErrorCode;
	message: string;
} {
	return { code: error.code, message: error.message };
}

export { ok, err };
