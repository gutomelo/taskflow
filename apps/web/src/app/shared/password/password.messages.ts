import type { FieldViolation, PasswordRule } from '@taskflow/contracts';

// Textos de interface centralizados (pt-BR) para facilitar a futura internacionalização.
export const passwordMessages = {
  heading: 'A senha precisa ter:',
  met: 'atendido',
  pending: 'pendente',
  allMet: 'Todos os requisitos de senha foram atendidos.',
  pendingSummary: (labels: ReadonlyArray<string>) => `Requisitos pendentes: ${labels.join('; ')}.`,
  rules: {
    min_length: 'pelo menos 8 caracteres',
    max_length: 'no máximo 128 caracteres',
    uppercase: 'uma letra maiúscula',
    lowercase: 'uma letra minúscula',
    digit: 'um número',
    symbol: 'um símbolo, como ! ? @ #',
    same_as_email: 'ser diferente do seu e-mail',
    common_password: 'não ser uma senha comum ou já vazada',
  } satisfies Record<PasswordRule, string>,
} as const;

/** Regras conhecidas pela interface (as chaves de `rules` cobrem todo `PasswordRule`). */
export function isPasswordRule(value: string): value is PasswordRule {
  return Object.hasOwn(passwordMessages.rules, value);
}

/** Regras de senha recusadas pela API (`PASSWORD_POLICY_VIOLATION`), ignorando desconhecidas. */
export function passwordRulesFrom(violations: ReadonlyArray<FieldViolation>): PasswordRule[] {
  return violations
    .filter((violation) => violation.field === 'password')
    .map((violation) => violation.message)
    .filter(isPasswordRule);
}
