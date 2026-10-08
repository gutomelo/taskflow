import { DomainError } from '@taskflow/backend/shared/kernel';

export const PERSON_NAME_MAX_LENGTH = 100;

export class InvalidPersonNameError extends DomainError {
  readonly code = 'INVALID_PERSON_NAME';

  constructor() {
    super('Invalid person name');
  }
}

/**
 * Nome de exibição: NFC, espaços nas bordas removidos e sequências internas reduzidas a um,
 * 1–100 caracteres, sem caracteres de controle (evita quebras de layout e de cabeçalhos).
 */
export class PersonName {
  private constructor(readonly value: string) {}

  static create(raw: string): PersonName {
    const normalized = raw.normalize('NFC').trim().replace(/\s+/gu, ' ');
    const length = [...normalized].length;

    if (length === 0 || length > PERSON_NAME_MAX_LENGTH || /\p{Cc}|\p{Cf}/u.test(normalized)) {
      throw new InvalidPersonNameError();
    }
    return new PersonName(normalized);
  }

  toString(): string {
    return this.value;
  }
}
