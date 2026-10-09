import { Queue } from 'bullmq';
import type { Logger } from 'pino';
import type { Clock } from '@taskflow/backend/shared/kernel';
import {
  createEventWorker,
  PrismaOutboxRetention,
  PrismaTransactionRunner,
  type EventWorker,
  type PrismaClient,
  type Redis,
} from '@taskflow/backend/shared/infrastructure';
import {
  PurgeExpiredIdentityDataUseCase,
  type IdentityPurgeReport,
} from '@taskflow/backend/identity/application';
import { PrismaIdentityDataRetention } from '@taskflow/backend/identity/infrastructure';
import { describeJobError } from './queues/email-jobs';

export const MAINTENANCE_QUEUE_NAME = 'maintenance';
export const DATA_PURGE_SCHEDULER_ID = 'daily-data-purge';
export const DATA_PURGE_JOB_NAME = 'maintenance.purge_expired_data';
/** Diariamente às 03:00 UTC (cron com segundos, como o BullMQ espera). */
export const DATA_PURGE_SCHEDULE = { pattern: '0 0 3 * * *', tz: 'UTC' } as const;
/** Eventos publicados ficam 7 dias na outbox (design da spec 001; ADR 0011). */
export const OUTBOX_RETENTION_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_RETRY_MS = 60_000;

export type DataPurgeReport = IdentityPurgeReport & Readonly<{ outboxEvents: number }>;

export interface MaintenanceDependencies {
  readonly prisma: PrismaClient;
  readonly redis: Redis;
  readonly redisUrl: string;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Manutenção agendada do worker (T22). O agendamento usa um job scheduler do BullMQ: com vários
 * workers, só um executa cada ocorrência; o `upsert` no start é idempotente.
 */
export function createMaintenance(deps: MaintenanceDependencies) {
  const { logger, clock } = deps;
  const transactions = new PrismaTransactionRunner(deps.prisma);
  const queue = new Queue(MAINTENANCE_QUEUE_NAME, { connection: deps.redis });
  // Listener obrigatório; a falha de conexão já é registrada pelo cliente Redis.
  queue.on('error', (error) => logger.debug({ err: error }, 'Maintenance queue error'));

  const purgeIdentity = new PurgeExpiredIdentityDataUseCase({
    retention: new PrismaIdentityDataRetention(transactions),
    clock,
  });
  const outboxRetention = new PrismaOutboxRetention(transactions);

  async function purgeExpiredData(): Promise<DataPurgeReport> {
    const identity = await purgeIdentity.execute();
    const outboxEvents = await outboxRetention.deletePublishedBefore(
      new Date(clock.now().getTime() - OUTBOX_RETENTION_DAYS * DAY_MS),
    );
    const report = { ...identity, outboxEvents };
    logger.info({ report }, 'Expired data purged');
    return report;
  }

  let consumer: EventWorker<DataPurgeReport, unknown> | undefined;
  let scheduleRetry: NodeJS.Timeout | undefined;

  function registerSchedule(): void {
    queue
      .upsertJobScheduler(DATA_PURGE_SCHEDULER_ID, DATA_PURGE_SCHEDULE, {
        name: DATA_PURGE_JOB_NAME,
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 60_000 },
          removeOnComplete: { age: 7 * 86_400 },
          removeOnFail: { age: 30 * 86_400 },
        },
      })
      .then(() => logger.info(DATA_PURGE_SCHEDULE, 'Daily data purge scheduled'))
      .catch((error: unknown) => {
        // Redis fora no start: tenta de novo, senão a limpeza só voltaria no próximo restart.
        logger.warn({ err: error }, 'Could not schedule data purge; retrying in 60 s');
        scheduleRetry = setTimeout(registerSchedule, SCHEDULE_RETRY_MS);
        scheduleRetry.unref();
      });
  }

  return {
    queue,
    purgeExpiredData,

    start(): void {
      if (consumer) return;
      consumer = createEventWorker<DataPurgeReport, unknown>({
        queueName: MAINTENANCE_QUEUE_NAME,
        redisUrl: deps.redisUrl,
        connectionName: 'taskflow-worker-maintenance',
        concurrency: 1,
        processor: () => purgeExpiredData(),
      });
      consumer.worker.on('failed', (job, error) =>
        logger.error(
          { jobId: job?.id, attempt: job?.attemptsMade, err: error },
          'Data purge job failed',
        ),
      );
      consumer.worker.on('error', (error) =>
        logger.warn(describeJobError(error), 'Maintenance worker error'),
      );
      registerSchedule();
    },

    /** Para o consumidor (aguardando a limpeza em andamento) e fecha a fila. */
    async stop(): Promise<unknown[]> {
      clearTimeout(scheduleRetry);
      const stopped = await Promise.allSettled([consumer?.close()]);
      consumer = undefined;
      const closed = await Promise.allSettled([queue.close()]);
      return [...stopped, ...closed].flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
    },
  };
}
