import type { Result } from "neverthrow";
import type { GameContent } from "../../domain/content/types.ts";
import type { DomainError } from "../../domain/shared/errors.ts";

export interface ContentRepository {
  load(): Promise<Result<GameContent, DomainError>>;
}
