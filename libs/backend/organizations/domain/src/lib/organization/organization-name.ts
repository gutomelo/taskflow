import { normalizeDisplayText } from '@taskflow/backend/shared/kernel';
import { InvalidOrganizationNameError } from '../errors';

export const ORGANIZATION_NAME_MAX_LENGTH = 80;

/**
 * Nome exibido em telas e em e-mails de convite para terceiros: texto exibível (sem controles
 * nem formatação invisível — anti-phishing), 2–80 caracteres. Editável.
 */
export class OrganizationName {
  private constructor(readonly value: string) {}

  static create(raw: string): OrganizationName {
    const normalized = normalizeDisplayText(raw, {
      minLength: 2,
      maxLength: ORGANIZATION_NAME_MAX_LENGTH,
    });
    if (normalized === null) throw new InvalidOrganizationNameError();
    return new OrganizationName(normalized);
  }

  toString(): string {
    return this.value;
  }
}
