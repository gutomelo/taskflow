import type { Request } from 'express';
import type { Pseudonymizer, RateLimitPolicy } from '@taskflow/backend/shared/application';
import { readCookie } from '@taskflow/backend/shared/http';
import { REFRESH_TOKEN_COOKIE } from './session-cookies';

const HOUR = 60 * 60;

/** Limites por endpoint (design da spec 001, tabela de endpoints; RNF-05). */
export const IDENTITY_RATE_LIMITS = {
  registerByIp: { name: 'auth.register.ip', points: 5, durationSeconds: HOUR },
  loginByIp: { name: 'auth.login.ip', points: 30, durationSeconds: 15 * 60 },
  refreshBySession: { name: 'auth.refresh.session', points: 60, durationSeconds: 60 },
  confirmVerificationByUser: {
    name: 'auth.verification-confirm.user',
    points: 20,
    durationSeconds: HOUR,
  },
  resendVerificationByUser: {
    name: 'auth.verification-resend.user',
    points: 3,
    durationSeconds: HOUR,
  },
  forgotPasswordByEmail: { name: 'auth.password-forgot.email', points: 3, durationSeconds: HOUR },
  forgotPasswordByIp: { name: 'auth.password-forgot.ip', points: 10, durationSeconds: HOUR },
  resetPasswordByIp: { name: 'auth.password-reset.ip', points: 10, durationSeconds: HOUR },
  changePasswordByUser: { name: 'me.password.user', points: 5, durationSeconds: HOUR },
} as const satisfies Record<string, RateLimitPolicy>;

/** Chave por e-mail do corpo, normalizado e pseudonimizado (nunca em claro no Redis). */
export function emailKey(pseudonymizer: Pseudonymizer) {
  return (request: Request): string | undefined => {
    const body: unknown = request.body;
    const email =
      typeof body === 'object' && body !== null && 'email' in body && typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : '';
    return email ? `email:${pseudonymizer.pseudonymize(email)}` : undefined;
  };
}

/** Chave pela sessão do refresh token (pseudonimizado); sem cookie, o handler já responde 401. */
export function refreshTokenKey(pseudonymizer: Pseudonymizer) {
  return (request: Request): string | undefined => {
    const refreshToken = readCookie(request, REFRESH_TOKEN_COOKIE);
    return refreshToken ? `refresh:${pseudonymizer.pseudonymize(refreshToken)}` : undefined;
  };
}

export const userKey = (request: Request): string | undefined =>
  request.actor ? `user:${request.actor.userId}` : undefined;
