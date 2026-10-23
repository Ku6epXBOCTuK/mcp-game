export type DomainError =
	| {
			code: "NotEnoughResources";
			message: string;
			item: string;
			required: number;
			available: number;
	  }
	| {
			code: "SkillTooLow";
			message: string;
			skill: string;
			requiredLevel: number;
			actualLevel: number;
	  }
	| { code: "RecipeUnknown"; message: string; recipeId: string }
	| { code: "ItemUnknown"; message: string; itemId: string }
	| {
			code: "UpgradeLocked";
			message: string;
			upgradeId: string;
			reason: string;
	  }
	| {
			code: "UpgradeMaxLevel";
			message: string;
			upgradeId: string;
			maxLevel: number;
	  }
	| { code: "AlreadyActing"; message: string; currentAction: string }
	| { code: "NoActiveAction"; message: string }
	| {
			code: "InsufficientFunds";
			message: string;
			required: number;
			available: number;
	  }
	| { code: "ZoneLocked"; message: string; zoneId: string; reason: string }
	| {
			code: "CreditLimitExceeded";
			message: string;
			limit: number;
			requested: number;
	  }
	| { code: "MonsterUnknown"; message: string; monsterId: string }
	| { code: "QuestNotCompleted"; message: string; questId: string }
	| { code: "QuestAlreadyClaimed"; message: string; questId: string }
	| { code: "UnknownCommand"; message: string; command: string }
	| {
			code: "ContentInvalid";
			message: string;
			path: string;
			id: string;
			detail: string;
	  }
	| { code: "NotSupported"; message: string; feature: string }
	| { code: "Traveling"; message: string; travelUntil: number };

export type DomainErrorCode = DomainError["code"];

export function errorMessage(error: DomainError): string {
	return error.message;
}
