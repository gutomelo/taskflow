/**
 * Limite de tentativas atingido por uma regra da aplicação (ex.: atraso progressivo de login,
 * BR-018). A camada HTTP responde 429 com `Retry-After`.
 */
export class RateLimitedError extends Error {
  readonly code = 'RATE_LIMITED';

  constructor(readonly retryAfterSeconds: number) {
    super('Too many attempts');
    this.name = 'RateLimitedError';
  }
}
