import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ConcurrentUpdateError,
  type TransactionRunner,
} from '@taskflow/backend/shared/application';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { isTransactionConflict } from './prisma-errors';

export type PrismaTransactionClient = Prisma.TransactionClient;

export class TransactionRequiredError extends Error {
  constructor(operation: string) {
    super(`${operation} must run inside TransactionRunner.run()`);
    this.name = 'TransactionRequiredError';
  }
}

export interface PrismaTransactionRunnerOptions {
  /** Tempo máximo de uma transação (ms). Transações longas seguram locks e conexões. */
  readonly timeoutMs?: number;
  /** Espera máxima por uma conexão do pool (ms). */
  readonly maxWaitMs?: number;
}

/**
 * Implementa `TransactionRunner` com transações interativas do Prisma. O cliente da
 * transação corrente fica em `AsyncLocalStorage`, restrito à infraestrutura: repositórios
 * obtêm o cliente por `client()` sem que a camada de aplicação conheça o Prisma.
 * Chamadas aninhadas reutilizam a transação externa.
 */
export class PrismaTransactionRunner implements TransactionRunner {
  private readonly storage = new AsyncLocalStorage<PrismaTransactionClient>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: PrismaTransactionRunnerOptions = {},
  ) {}

  /**
   * Transação interativa em **READ COMMITTED** (fixado: os protocolos de lock das specs 003/004
   * dependem de quem chega depois reler o que foi gravado). A transação mais externa é repetida
   * **uma vez** em deadlock ou conflito de escrita; persistindo, `ConcurrentUpdateError` (409).
   * Por isso `work` precisa ser reexecutável: nada de efeito externo dentro dela (ADR 0008).
   */
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.storage.getStore()) {
      return work();
    }
    try {
      return await this.once(work);
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      try {
        return await this.once(work);
      } catch (retryError) {
        if (isTransactionConflict(retryError))
          throw new ConcurrentUpdateError({ cause: retryError });
        throw retryError;
      }
    }
  }

  private once<T>(work: () => Promise<T>): Promise<T> {
    return this.prisma.$transaction((transaction) => this.storage.run(transaction, work), {
      timeout: this.options.timeoutMs ?? 5_000,
      maxWait: this.options.maxWaitMs ?? 2_000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }

  /** Cliente da transação corrente ou, fora dela, o cliente padrão (leituras simples). */
  client(): PrismaTransactionClient {
    return this.storage.getStore() ?? this.prisma;
  }

  /** Cliente da transação corrente; falha fora de transação (ex.: locks, outbox). */
  transactionalClient(operation: string): PrismaTransactionClient {
    const transaction = this.storage.getStore();
    if (!transaction) {
      throw new TransactionRequiredError(operation);
    }
    return transaction;
  }
}
