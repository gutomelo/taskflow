/**
 * Capacidade momentaneamente esgotada (ex.: limite de hashes Argon2 simultâneos).
 * Não é regra de negócio: a camada HTTP responde 503 com `Retry-After`.
 */
export class ServiceBusyError extends Error {
  readonly code = 'SERVICE_BUSY';

  constructor(
    readonly resource: string,
    readonly retryAfterSeconds: number,
  ) {
    super(`${resource} is at capacity`);
    this.name = 'ServiceBusyError';
  }
}
