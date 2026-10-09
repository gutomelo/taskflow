import { Redis } from 'ioredis';
import { Worker, type Job } from 'bullmq';
import type { OutboxJobData } from './bullmq-event-publisher';

export interface EventWorkerOptions<TResult> {
  readonly queueName: string;
  readonly redisUrl: string;
  readonly connectionName: string;
  readonly concurrency?: number;
  readonly processor: (job: Job<OutboxJobData>) => Promise<TResult>;
}

export interface EventWorker<TResult> {
  readonly worker: Worker<OutboxJobData, TResult>;
  /** Para de buscar jobs, aguarda os ativos terminarem e fecha a conexão própria. */
  close(): Promise<void>;
}

/**
 * Consumidor BullMQ com conexão própria. Diferente do produtor (fail-fast), o `Worker` exige
 * `maxRetriesPerRequest: null`: comandos bloqueantes esperam o Redis voltar em vez de falhar.
 */
export function createEventWorker<TResult>({
  queueName,
  redisUrl,
  connectionName,
  concurrency = 5,
  processor,
}: EventWorkerOptions<TResult>): EventWorker<TResult> {
  const connection = new Redis(redisUrl, { connectionName, maxRetriesPerRequest: null });
  const worker = new Worker<OutboxJobData, TResult>(queueName, processor, {
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
