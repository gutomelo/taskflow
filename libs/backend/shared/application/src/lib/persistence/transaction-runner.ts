/**
 * Fronteira transacional controlada pelo caso de uso (BR-010).
 * Repositórios e o `OutboxWriter` chamados dentro de `work` participam da mesma
 * transação; erros lançados por `work` desfazem tudo. Não faça I/O externo
 * (e-mail, fila, hashing caro) dentro de `work`.
 */
export interface TransactionRunner {
  run<T>(work: () => Promise<T>, options?: TransactionOptions): Promise<T>;
}

/** Opções da transação mais externa (ignoradas quando `run` é chamado dentro de outra). */
export type TransactionOptions = Readonly<{
  /**
   * Espera máxima por um lock (ms). Excedida, a transação falha com `ConcurrentUpdateError`
   * (409, o cliente repete) em vez de segurar uma conexão do pool até o timeout da transação.
   */
  lockTimeoutMs?: number;
}>;
