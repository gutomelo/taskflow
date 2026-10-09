import { Redis } from 'ioredis';
import { Worker, type Job } from 'bullmq';
import type { OutboxJobData } from './bullmq-event-publisher';

export interface EventWorkerOptions<TResult, TData = OutboxJobData> {
  readonly queueName: string;
  readonly redisUrl: string;
  readonly connectionName: string;
  readonly concurrency?: number;
  readonly processor: (job: Job<TData>) => Promise<TResult>;
}

export interface EventWorker<TResult, TData = OutboxJobData> {
  readonly worker: Worker<TData, TResult>;
  /** Para de buscar jobs, aguarda os ativos terminarem e fecha a conexão própria. */
  close(): Promise<void>;
}

/**
 * Consumidor BullMQ com conexão própria. Diferente do produtor (fail-fast), o `Worker` exige
 * `maxRetriesPerRequest: null`: comandos bloqueantes esperam o Redis voltar em vez de falhar.
 */
export function createEventWorker<TResult, TData = OutboxJobData>({
  queueName,
  redisUrl,
  connectionName,
  concurrency = 5,
  processor,
}: EventWorkerOptions<TResult, TData>): EventWorker<TResult, TData> {
  const connection = new Redis(redisUrl, { connectionName, maxRetriesPerRequest: null });
  const worker = new Worker<TData, TResult>(queueName, processor, {
    connection,
    concurrency,
  });
  return {
    worker,
    async close() {
      await worker.close();
      await connection.quit().catch(() => connection.disconnect());
    },
  };
}
