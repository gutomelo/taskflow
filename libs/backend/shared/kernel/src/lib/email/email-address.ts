import { DomainError } from '../errors/domain-error';

// Limites da RFC 5321 (caminho SMTP): 254 caracteres no total, 64 na parte local.
const MAX_LENGTH = 254;
const MAX_LOCAL_PART_LENGTH = 64;

// Validação pragmática: rejeita formatos claramente inválidos sem tentar cobrir toda a RFC 5322.
// A posse do endereço é comprovada pela verificação de e-mail (BR-017), não pelo formato.
// Apenas ASCII: endereços internacionalizados (SMTPUTF8/IDN) não são suportados no MVP.
const EMAIL_PATTERN =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export class InvalidEmailAddressError extends DomainError {
  readonly code = 'INVALID_EMAIL_ADDRESS';

  constructor() {
    // Sem o valor recebido na mensagem: e-mail é dado pessoal e mensagens vão para logs.
    super('Invalid email address');
  }
}

/** Endereço de e-mail normalizado (trim, minúsculas) e validado. Imutável. */
export class EmailAddress {
  private constructor(readonly value: string) {}

  static create(raw: string): EmailAddress {
    const normalized = raw.trim().toLowerCase();
    const [localPart = ''] = normalized.split('@');

    if (
      normalized.length > MAX_LENGTH ||
      localPart.length > MAX_LOCAL_PART_LENGTH ||
      localPart.startsWith('.') ||
      localPart.endsWith('.') ||
      localPart.includes('..') ||
      !EMAIL_PATTERN.test(normalized)
    ) {
      throw new InvalidEmailAddressError();
    }
    return new EmailAddress(normalized);
  }

  equals(other: EmailAddress): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
