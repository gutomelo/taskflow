import type { LoginFailureState } from '../ports/login-attempt-tracker';

/** BR-018 */
export const FREE_LOGIN_FAILURES = 5;
export const MAX_LOGIN_DELAY_SECONDS = 15 * 60;

/**
 * Espera exigida antes da próxima tentativa: nenhuma até 5 falhas consecutivas; depois
 * 1 s, 2 s, 4 s… dobrando a cada falha, limitada a 15 min. Nunca bloqueia permanentemente
 * (bloqueio permanente permitiria a um atacante trancar a conta da vítima).
 */
export function requiredLoginDelaySeconds(consecutiveFailures: number): number {
  if (consecutiveFailures < FREE_LOGIN_FAILURES) return 0;
  const exponent = consecutiveFailures - FREE_LOGIN_FAILURES;
  return Math.min(2 ** exponent, MAX_LOGIN_DELAY_SECONDS);
}

/** Segundos que ainda faltam esperar no instante `now` (0 = tentativa permitida). */
export function remainingLoginDelaySeconds(state: LoginFailureState, now: Date): number {
  const delay = requiredLoginDelaySeconds(state.consecutiveFailures);
  if (delay === 0 || !state.lastFailureAt) return 0;
  const elapsedMs = now.getTime() - state.lastFailureAt.getTime();
  const remainingMs = delay * 1000 - elapsedMs;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}
