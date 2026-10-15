/**
 * A transação perdeu para outra (deadlock ou conflito de escrita) mesmo depois de repetida uma vez
 * pelo `TransactionRunner`. A camada HTTP responde 409: o cliente pode tentar de novo.
 */
export class ConcurrentUpdateError extends Error {
  readonly code = 'CONCURRENT_UPDATE';

  constructor(options?: ErrorOptions) {
    super('Concurrent update: please retry', options);
    this.name = 'ConcurrentUpdateError';
  }
}
