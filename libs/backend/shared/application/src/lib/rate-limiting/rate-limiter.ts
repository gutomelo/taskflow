/** Política de limite: no máximo `points` consumos por janela de `durationSeconds`. */
export type RateLimitPolicy = Readonly<{
  /** Nome estável usado como prefixo das chaves (ex.: `auth.login.ip`). */
  name: string;
  points: number;
  durationSeconds: number;
}>;

export type RateLimitDecision =
  | Readonly<{ allowed: true; remainingPoints: number }>
  | Readonly<{ allowed: false; retryAfterSeconds: number }>;

/**
 * Limitador de taxa. `key` identifica o sujeito (IP, hash de e-mail, usuário) e nunca
 * deve conter dado pessoal em claro. Implementações continuam limitando, em memória,
 * quando o armazenamento distribuído estiver indisponível.
 */
export interface RateLimiter {
  consume(policy: RateLimitPolicy, key: string): Promise<RateLimitDecision>;
  reset(policy: RateLimitPolicy, key: string): Promise<void>;
}
