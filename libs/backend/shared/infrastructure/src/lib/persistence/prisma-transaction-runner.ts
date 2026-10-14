import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ConcurrentUpdateError,
  type TransactionOptions,
  type TransactionRunner,
} from '@taskflow/backend/shared/application';
import { Prisma, type PrismaClient } from '../../generated/prisma/client';
import { isLockTimeout, isTransactionConflict } from './prisma-errors';

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
   * Com `lockTimeoutMs`, a espera por lock excedida vira `ConcurrentUpdateError`, sem repetir.
   */
  async run<T>(work: () => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    if (this.storage.getStore()) {
      return work();
    }
    try {
      return await this.once(work, options);
    } catch (error) {
      if (isLockTimeout(error)) throw new ConcurrentUpdateError({ cause: error });
      if (!isTransactionConflict(error)) throw error;
      try {
        return await this.once(work, options);
      } catch (retryError) {
        if (isTransactionConflict(retryError) || isLockTimeout(retryError))
          throw new ConcurrentUpdateError({ cause: retryError });
        throw retryError;
      }
    }
  }

  private once<T>(work: () => Promise<T>, options: TransactionOptions): Promise<T> {
    const { lockTimeoutMs } = options;
    return this.prisma.$transaction(
      async (transaction) => {
        if (lockTimeoutMs !== undefined) {
          // `set_config(…, true)` = `SET LOCAL`: vale só nesta transação; valor parametrizado.
          await transaction.$queryRaw`SELECT set_config('lock_timeout', ${`${Math.trunc(lockTimeoutMs)}ms`}, true)`;
        }
        return this.storage.run(transaction, work);
      },
      {
        timeout: this.options.timeoutMs ?? 5_000,
        maxWait: this.options.maxWaitMs ?? 2_000,
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      },
    );
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
