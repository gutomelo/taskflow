/** Histórico de falhas de login de uma conta (chave pseudonimizada). */
export type LoginFailureState = Readonly<{
  consecutiveFailures: number;
  lastFailureAt: Date | null;
}>;

/**
 * Armazena falhas consecutivas de login por conta (BR-018). A política de atraso fica na
 * aplicação (`progressiveLoginDelay`); a implementação apenas persiste o estado (Redis, com
 * fallback em memória quando indisponível).
 */
/** Posse exclusiva da conta durante uma tentativa de login (T29/I2). */
export interface LoginAttemptLease {
  release(): Promise<void>;
}

export interface LoginAttemptTracker {
  /**
   * Reserva a conta para uma tentativa: no máximo uma em andamento por conta, em todas as
   * instâncias. `null` se outra tentativa está em curso. A reserva expira sozinha após `ttlMs`
   * (processo que caiu no meio não trava a conta).
   */
  beginAttempt(accountKey: string, ttlMs: number): Promise<LoginAttemptLease | null>;
  get(accountKey: string): Promise<LoginFailureState>;
  recordFailure(accountKey: string, at: Date): Promise<void>;
  reset(accountKey: string): Promise<void>;
}
