import type { PasswordRule } from '@taskflow/contracts';

const MIN_LENGTH = 8;
const MAX_LENGTH = 128;

/**
 * Espelho de BR-011 para feedback imediato. A fonte da verdade é o domínio
 * (`libs/backend/identity/domain/src/lib/password/password.ts`): mesma normalização NFC,
 * comprimento em code points e definição de símbolo. A lista de senhas comuns
 * (`common_password`) só existe no backend e chega pelo erro 422.
 */
export function unmetPasswordRules(password: string, email: string): PasswordRule[] {
  const normalized = password.normalize('NFC');
  const length = [...normalized].length;
  const unmet: PasswordRule[] = [];
  if (length < MIN_LENGTH) unmet.push('min_length');
  if (length > MAX_LENGTH) unmet.push('max_length');
  if (!/\p{Lu}/u.test(normalized)) unmet.push('uppercase');
  if (!/\p{Ll}/u.test(normalized)) unmet.push('lowercase');
  if (!/\p{Nd}/u.test(normalized)) unmet.push('digit');
  if (!/[^\p{L}\p{N}\s]/u.test(normalized)) unmet.push('symbol');
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail && normalized.toLowerCase() === normalizedEmail) unmet.push('same_as_email');
  return unmet;
}
