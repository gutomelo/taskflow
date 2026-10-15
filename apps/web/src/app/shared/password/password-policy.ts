import type { AbstractControl, ValidationErrors } from '@angular/forms';
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

/** Validador de formulário: e-mail lido do campo irmão `email`, quando existir. */
export function passwordPolicyValidator(control: AbstractControl<string>): ValidationErrors | null {
  const email: unknown = control.parent?.get('email')?.value;
  return policyErrors(control.value, typeof email === 'string' ? email : '');
}

/** Variante com o e-mail vindo de fora do formulário (ex.: o usuário da sessão). */
export function passwordPolicyValidatorFor(email: () => string) {
  return (control: AbstractControl<string>): ValidationErrors | null =>
    policyErrors(control.value, email());
}

function policyErrors(password: string, email: string): ValidationErrors | null {
  if (password.length === 0) return null; // `required` cuida do vazio
  const unmet = unmetPasswordRules(password, email);
  return unmet.length > 0 ? { passwordPolicy: unmet } : null;
}
