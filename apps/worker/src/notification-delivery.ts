import { Queue, UnrecoverableError, type Job, type JobsOptions } from 'bullmq';
import type { Logger } from 'pino';
import type { DigestOutcome, RecordOutcome } from '@taskflow/backend/notifications/application';
import type { EmailSender } from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import {
  createEventQueue,
  createEventWorker,
  PrismaTransactionRunner,
  type EventWorker,
  type PrismaClient,
  type Redis,
} from '@taskflow/backend/shared/infrastructure';
import { createNotificationsModule } from './modules/notifications.module';
import type { OutboxRoutes } from './outbox-relay';
import { describeJobError } from './queues/email-jobs';
import {
  createNotificationJobProcessor,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATIONS_QUEUE_NAME,
} from './queues/notification-jobs';

export const DIGEST_QUEUE_NAME = 'notification-digests';
export const DIGEST_SCHEDULER_ID = 'hourly-digest-plan';
export const DIGEST_PLAN_JOB_NAME = 'notifications.plan_digests';
export const DIGEST_SEND_JOB_NAME = 'notifications.send_digest';
/** De hora em hora, no minuto zero (UTC; cron com segundos, como o BullMQ espera). */
export const DIGEST_SCHEDULE = { pattern: '0 0 * * * *', tz: 'UTC' } as const;

const SCHEDULE_RETRY_MS = 60_000;
const ENQUEUE_BATCH = 500;

type DigestJobData = Readonly<{ userId?: string }>;
type DigestJobResult = Readonly<{ planned: number }> | Readonly<{ outcome: DigestOutcome }>;

/**
 * Um job por pessoa e hora (D5): `jobId` com a hora UTC. Planejar de novo na mesma hora (dois
 * workers, retry do fan-out) não duplica o envio enquanto o job existir no Redis (24 h).
 */
export function digestJobId(userId: string, at: Date): string {
  const hour = at.toISOString().slice(0, 13).replace(/[-T]/g, '');
  return `digest-${userId}-${hour}`;
}

export interface NotificationDeliveryDependencies {
  readonly prisma: PrismaClient;
  readonly redis: Redis;
  readonly redisUrl: string;
  readonly emailSender: EmailSender;
  readonly appUrl: string;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Sobrescritas das opções dos jobs (testes usam backoff curto). */
  readonly jobOptions?: JobsOptions;
}

/**
 * Pipeline de notificações do worker (spec 008, T8): fila `notifications` (eventos de integração
 * publicados pelo relay único) → `RecordNotifications`; fila `notification-digests` com o
 * fan-out horário e um job de envio por pessoa.
 */
export function createNotificationDelivery(deps: NotificationDeliveryDependencies) {
  const { logger, clock } = deps;
  const notifications = createNotificationsModule({
    transactions: new PrismaTransactionRunner(deps.prisma),
    emailSender: deps.emailSender,
    idGenerator: deps.idGenerator,
    clock,
    appUrl: deps.appUrl,
  });

  const queue = createEventQueue(NOTIFICATIONS_QUEUE_NAME, deps.redis, deps.jobOptions);
  // Listener obrigatório; a falha de conexão já é registrada pelo cliente Redis.
  queue.on('error', (error) => logger.debug({ err: error }, 'Notifications queue error'));
  const routes: OutboxRoutes = new Map(NOTIFICATION_EVENT_TYPES.map((type) => [type, queue]));
  const processNotificationJob = createNotificationJobProcessor(
    notifications.recordNotifications,
    logger,
  );

  const digestQueue = new Queue<DigestJobData>(DIGEST_QUEUE_NAME, {
    connection: deps.redis,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 7 * 86_400 },
      ...deps.jobOptions,
    },
  });
  digestQueue.on('error', (error) => logger.debug({ err: error }, 'Digest queue error'));

  /** Fan-out (BR-034): enfileira um envio por pessoa; nunca envia nada aqui. */
  async function planDigests(): Promise<number> {
    const now = clock.now();
    const userIds = await notifications.planDigests.execute(now);
    for (let start = 0; start < userIds.length; start += ENQUEUE_BATCH) {
      await digestQueue.addBulk(
        userIds.slice(start, start + ENQUEUE_BATCH).map((userId) => ({
          name: DIGEST_SEND_JOB_NAME,
          data: { userId },
          opts: { jobId: digestJobId(userId, now) },
        })),
      );
    }
    logger.info({ planned: userIds.length }, 'Notification digests planned');
    return userIds.length;
  }

  async function processDigestJob(job: Job<DigestJobData>): Promise<DigestJobResult> {
    if (job.name === DIGEST_PLAN_JOB_NAME) return { planned: await planDigests() };
    const { userId } = job.data;
    if (job.name !== DIGEST_SEND_JOB_NAME || typeof userId !== 'string') {
      throw new UnrecoverableError(`Invalid digest job "${job.name}"`);
    }
    const outcome = await notifications.sendDigest.execute(userId, clock.now());
    logger.info({ jobId: job.id, attempt: job.attemptsMade + 1, outcome }, 'Digest job processed');
    return { outcome };
  }

  let consumer: EventWorker<RecordOutcome> | undefined;
  let digestConsumer: EventWorker<DigestJobResult, DigestJobData> | undefined;
  let scheduleRetry: NodeJS.Timeout | undefined;

  function registerSchedule(): void {
    digestQueue
      .upsertJobScheduler(DIGEST_SCHEDULER_ID, DIGEST_SCHEDULE, {
        name: DIGEST_PLAN_JOB_NAME,
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
      })
      .then(() => logger.info(DIGEST_SCHEDULE, 'Hourly digest plan scheduled'))
      .catch((error: unknown) => {
        logger.warn({ err: error }, 'Could not schedule digest plan; retrying in 60 s');
        scheduleRetry = setTimeout(registerSchedule, SCHEDULE_RETRY_MS);
        scheduleRetry.unref();
      });
  }

  return {
    queue,
    digestQueue,
    routes,
    processNotificationJob,
    planDigests,
    purgeOldNotifications: notifications.purgeOldNotifications,

    start(): void {
      if (consumer) return;
      consumer = createEventWorker({
        queueName: NOTIFICATIONS_QUEUE_NAME,
        redisUrl: deps.redisUrl,
        connectionName: 'taskflow-worker-notifications',
        processor: processNotificationJob,
      });
      consumer.worker.on('failed', (job, error) =>
        logger.warn(
          { eventId: job?.id, type: job?.name, attempt: job?.attemptsMade, err: error },
          'Notification job failed',
        ),
      );
      consumer.worker.on('error', (error) =>
        logger.warn(describeJobError(error), 'Notifications worker error'),
      );
      digestConsumer = createEventWorker<DigestJobResult, DigestJobData>({
        queueName: DIGEST_QUEUE_NAME,
        redisUrl: deps.redisUrl,
        connectionName: 'taskflow-worker-digests',
        concurrency: 2,
        processor: processDigestJob,
      });
      // `describeJobError`: falha de SMTP pode trazer o endereço na mensagem.
      digestConsumer.worker.on('failed', (job, error) =>
        logger.warn(
          { jobId: job?.id, attempt: job?.attemptsMade, ...describeJobError(error) },
          'Digest job failed',
        ),
      );
      digestConsumer.worker.on('error', (error) =>
        logger.warn(describeJobError(error), 'Digest worker error'),
      );
      registerSchedule();
      logger.info(
        { queue: NOTIFICATIONS_QUEUE_NAME, eventTypes: NOTIFICATION_EVENT_TYPES.length },
        'Notification delivery started',
      );
    },

    /** Para os consumidores (aguardando os jobs em andamento) e fecha as filas. */
    async stop(): Promise<unknown[]> {
      clearTimeout(scheduleRetry);
      const stopped = await Promise.allSettled([consumer?.close(), digestConsumer?.close()]);
      consumer = undefined;
      digestConsumer = undefined;
      const closed = await Promise.allSettled([queue.close(), digestQueue.close()]);
      return [...stopped, ...closed].flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
    },
  };
}

export type NotificationDelivery = ReturnType<typeof createNotificationDelivery>;
