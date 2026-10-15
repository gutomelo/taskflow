import type { Request } from 'express';
import type { Pseudonymizer, RateLimitPolicy } from '@taskflow/backend/shared/application';

const HOUR = 60 * 60;

/** Limites por endpoint (design da spec 001, tabela de endpoints; RNF-05). */
export const IDENTITY_RATE_LIMITS = {
  registerByIp: { name: 'auth.register.ip', points: 5, durationSeconds: HOUR },
  loginByIp: { name: 'auth.login.ip', points: 30, durationSeconds: 15 * 60 },
  // Por IP (T29/B3): a chave pelo refresh token mudava a cada rotação e nunca limitava nada.
  // Folgado para várias pessoas atrás do mesmo NAT (cada aba renova a cada ~15 min).
  refreshByIp: { name: 'auth.refresh.ip', points: 120, durationSeconds: 60 },
  logoutByIp: { name: 'auth.logout.ip', points: 60, durationSeconds: 60 },
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

export const userKey = (request: Request): string | undefined =>
  request.actor ? `user:${request.actor.userId}` : undefined;
