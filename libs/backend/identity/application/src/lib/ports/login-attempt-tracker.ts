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
export interface LoginAttemptTracker {
  get(accountKey: string): Promise<LoginFailureState>;
  recordFailure(accountKey: string, at: Date): Promise<void>;
  reset(accountKey: string): Promise<void>;
}
