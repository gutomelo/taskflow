import { normalizeDisplayText } from '@taskflow/backend/shared/kernel';
import { InvalidProjectNameError } from '../errors';

export const PROJECT_NAME_MAX_LENGTH = 80;

/** Texto exibível (sem controles nem formatação invisível), 2–80 caracteres. Editável. */
export class ProjectName {
  private constructor(readonly value: string) {}

  static create(raw: string): ProjectName {
    const normalized = normalizeDisplayText(raw, {
      minLength: 2,
      maxLength: PROJECT_NAME_MAX_LENGTH,
    });
    if (normalized === null) throw new InvalidProjectNameError();
    return new ProjectName(normalized);
  }

  toString(): string {
    return this.value;
  }
}
