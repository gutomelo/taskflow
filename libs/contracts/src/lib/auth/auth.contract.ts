import { z } from 'zod';

/**
 * Contratos HTTP de Identity & Access (spec 001). Validação de **formato** na fronteira;
 * regras de negócio (BR-011, normalização de e-mail) ficam no domínio. Limites de tamanho
 * evitam payloads abusivos (ex.: senha gigante para estressar o Argon2).
 */
const emailField = z.string().trim().min(3).max(254);
const passwordField = z.string().min(1).max(1024);
const tokenField = z.string().min(16).max(256);

export const registerRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(100),
  email: emailField,
  password: passwordField,
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.strictObject({
  email: emailField,
  password: passwordField,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const confirmEmailVerificationRequestSchema = z.strictObject({ token: tokenField });
export type ConfirmEmailVerificationRequest = z.infer<typeof confirmEmailVerificationRequestSchema>;

export const forgotPasswordRequestSchema = z.strictObject({ email: emailField });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.strictObject({
  token: tokenField,
  newPassword: passwordField,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const changePasswordRequestSchema = z.strictObject({
  currentPassword: passwordField,
  newPassword: passwordField,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export const currentUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

export const sessionSummarySchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  /** Estruturado: o frontend compõe o texto (i18n). `null` quando não reconhecido. */
  device: z.object({ browser: z.string().nullable(), os: z.string().nullable() }),
  isCurrent: z.boolean(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;

export const sessionListSchema = z.object({ items: z.array(sessionSummarySchema) });
export type SessionList = z.infer<typeof sessionListSchema>;

export const sessionIdParamSchema = z.object({ sessionId: z.uuid() });

/** Regras de BR-011 devolvidas em `violations[].message` do Problem Details (422). */
export const passwordRuleSchema = z.enum([
  'min_length',
  'max_length',
  'uppercase',
  'lowercase',
  'digit',
  'symbol',
  'same_as_email',
  'common_password',
]);
export type PasswordRule = z.infer<typeof passwordRuleSchema>;
