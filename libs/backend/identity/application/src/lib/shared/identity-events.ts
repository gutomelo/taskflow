/** Eventos de integração do contexto identity (fila `emails`, ADR 0011). Payloads sem dados sensíveis. */
export const IdentityEventType = {
  emailVerificationRequested: 'identity.email_verification_requested',
  accountAlreadyExistsNotice: 'identity.account_already_exists_notice',
  passwordResetRequested: 'identity.password_reset_requested',
  passwordChangedNotice: 'identity.password_changed_notice',
} as const;

export type IdentityEventType = (typeof IdentityEventType)[keyof typeof IdentityEventType];

export type UserEventPayload = Readonly<{ userId: string }>;
/** Recuperação usa o e-mail (trabalho constante: o worker descarta se não houver conta). */
export type PasswordResetRequestedPayload = Readonly<{ email: string }>;
