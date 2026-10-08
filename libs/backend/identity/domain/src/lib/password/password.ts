import { DomainError, type EmailAddress } from '@taskflow/backend/shared/kernel';
import type { CommonPasswordList } from './common-password-list';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Regras de BR-011, expostas ao cliente para feedback por requisito. */
export type PasswordRule =
  | 'min_length'
  | 'max_length'
  | 'uppercase'
  | 'lowercase'
  | 'digit'
  | 'symbol'
  | 'same_as_email'
  | 'common_password';

export class PasswordPolicyViolationError extends DomainError {
  readonly code = 'PASSWORD_POLICY_VIOLATION';

  constructor(readonly violatedRules: ReadonlyArray<PasswordRule>) {
    super(`Password violates policy rules: ${violatedRules.join(', ')}`);
  }
}

export interface PasswordPolicyContext {
  readonly email: EmailAddress;
  readonly commonPasswords: CommonPasswordList;
}

const REDACTED = '[REDACTED]';

/**
 * Senha em texto puro validada por BR-011. Existe apenas entre a entrada do usuário e o
 * hash: nunca é persistida, e `toString`, `toJSON` e `util.inspect` não revelam o valor.
 * Normalizada em NFC (a mesma senha digitada em teclados diferentes gera o mesmo hash)
 * e nunca truncada; os limites contam caracteres (code points), não bytes.
 */
export class Password {
  private constructor(private readonly plainText: string) {}

  static create(raw: string, { email, commonPasswords }: PasswordPolicyContext): Password {
    const normalized = raw.normalize('NFC');
    const length = [...normalized].length;
    const violatedRules: PasswordRule[] = [];

    if (length < PASSWORD_MIN_LENGTH) violatedRules.push('min_length');
    if (length > PASSWORD_MAX_LENGTH) violatedRules.push('max_length');
    if (!/\p{Lu}/u.test(normalized)) violatedRules.push('uppercase');
    if (!/\p{Ll}/u.test(normalized)) violatedRules.push('lowercase');
    if (!/\p{Nd}/u.test(normalized)) violatedRules.push('digit');
    // Símbolo: qualquer caractere que não seja letra, número ou espaço em branco.
    if (!/[^\p{L}\p{N}\s]/u.test(normalized)) violatedRules.push('symbol');
    if (normalized.toLowerCase() === email.value) violatedRules.push('same_as_email');
    if (commonPasswords.contains(normalized)) violatedRules.push('common_password');

    if (violatedRules.length > 0) {
      throw new PasswordPolicyViolationError(violatedRules);
    }
    return new Password(normalized);
  }

  /** Único acesso ao texto puro: usado exclusivamente pelo `PasswordHasher`. */
  reveal(): string {
    return this.plainText;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `Password(${REDACTED})`;
  }
}
