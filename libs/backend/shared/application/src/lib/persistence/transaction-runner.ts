/**
 * Fronteira transacional controlada pelo caso de uso (BR-010).
 * Repositórios e o `OutboxWriter` chamados dentro de `work` participam da mesma
 * transação; erros lançados por `work` desfazem tudo. Não faça I/O externo
 * (e-mail, fila, hashing caro) dentro de `work`.
 */
export interface TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T>;
}
