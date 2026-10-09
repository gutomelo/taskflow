import { DomainError, normalizeDisplayText } from '@taskflow/backend/shared/kernel';

export const PERSON_NAME_MAX_LENGTH = 100;

export class InvalidPersonNameError extends DomainError {
  readonly code = 'INVALID_PERSON_NAME';

  constructor() {
    super('Invalid person name');
  }
}

/**
 * Nome de exibição (aparece em telas e em e-mails para outras pessoas): texto exibível do
 * kernel — NFC, espaços normalizados, 1–100 caracteres, sem controles nem formatação invisível.
 */
export class PersonName {
  private constructor(readonly value: string) {}

  static create(raw: string): PersonName {
    const normalized = normalizeDisplayText(raw, {
      minLength: 1,
      maxLength: PERSON_NAME_MAX_LENGTH,
    });
    if (normalized === null) throw new InvalidPersonNameError();
    return new PersonName(normalized);
  }

  toString(): string {
    return this.value;
  }
}
