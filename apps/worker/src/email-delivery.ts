import type { JobsOptions } from 'bullmq';
import type { Logger } from 'pino';
import type { EmailSender } from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import {
  BullMqEventPublisher,
  createEventQueue,
  createEventWorker,
  OutboxRelay,
  PrismaTransactionRunner,
  type EventWorker,
  type PrismaClient,
  type Redis,
} from '@taskflow/backend/shared/infrastructure';
import type { EmailDeliveryOutcome } from '@taskflow/backend/identity/application';
import { createIdentityEmailsModule } from './modules/identity-emails.module';
import { describeJobError } from './queues/email-jobs';
import { EMAIL_EVENT_TYPES, EMAIL_QUEUE_NAME } from './queues/email-queue';

export interface EmailDeliveryDependencies {
  readonly prisma: PrismaClient;
  /** Cliente fail-fast compartilhado (produtor da fila). */
  readonly redis: Redis;
  /** URL para a conexão própria do consumidor (comandos bloqueantes). */
  readonly redisUrl: string;
  readonly emailSender: EmailSender;
  readonly appUrl: string;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly relayPollIntervalMs?: number;
  /** Sobrescritas das opções dos jobs (testes usam backoff curto). */
  readonly jobOptions?: JobsOptions;
}

/**
 * Pipeline de e-mails do worker (ADR 0011): `OutboxRelay` → fila `emails` → consumidor →
 * casos de uso de envio. Montado aqui para que `main.ts` e o teste de integração usem a mesma
 * composição.
 */
export function createEmailDelivery(deps: EmailDeliveryDependencies) {
  const { logger } = deps;
  const transactions = new PrismaTransactionRunner(deps.prisma);
  const queue = createEventQueue(EMAIL_QUEUE_NAME, deps.redis, deps.jobOptions);
  // Listener obrigatório (EventEmitter sem 'error' derruba o processo); a falha de conexão já
  // é registrada pelo cliente Redis, então aqui fica em debug para não duplicar o log.
  queue.on('error', (error) => logger.debug({ err: error }, 'Email queue error'));

  const relay = new OutboxRelay({
    transactions,
    publisher: new BullMqEventPublisher(new Map(EMAIL_EVENT_TYPES.map((type) => [type, queue]))),
    clock: deps.clock,
    logger,
    ...(deps.relayPollIntervalMs === undefined ? {} : { pollIntervalMs: deps.relayPollIntervalMs }),
  });
  const { processEmailJob } = createIdentityEmailsModule({
    transactions,
    emailSender: deps.emailSender,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
    appUrl: deps.appUrl,
    logger,
  });
  let consumer: EventWorker<EmailDeliveryOutcome> | undefined;

  return {
    queue,
    processEmailJob,

    start(): void {
      if (consumer) return;
      relay.start();
      consumer = createEventWorker({
        queueName: EMAIL_QUEUE_NAME,
        redisUrl: deps.redisUrl,
        connectionName: 'taskflow-worker-emails',
        processor: processEmailJob,
      });
      consumer.worker.on('failed', (job, error) => {
        const attempts = job?.opts.attempts ?? 1;
        const isFinal = !job || job.attemptsMade >= attempts || error.name === 'UnrecoverableError';
        const details = {
          eventId: job?.id,
          type: job?.name,
          attempt: job?.attemptsMade,
          ...describeJobError(error),
        };
        if (isFinal) logger.error(details, 'Email job failed permanently');
        else logger.warn(details, 'Email job failed; will retry');
      });
      consumer.worker.on('error', (error) =>
        logger.warn(describeJobError(error), 'Email worker error'),
      );
      logger.info(
        { queue: EMAIL_QUEUE_NAME, eventTypes: EMAIL_EVENT_TYPES.length },
        'Email delivery started',
      );
    },

    /**
     * Para consumidor e relay (aguardando envios e lote em andamento) e fecha a fila.
     * Devolve os motivos das falhas, para o chamador registrar e decidir o código de saída.
     */
    async stop(): Promise<unknown[]> {
      const stopped = await Promise.allSettled([consumer?.close(), relay.stop()]);
      consumer = undefined;
      const closed = await Promise.allSettled([queue.close()]);
      return [...stopped, ...closed].flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
    },
  };
}

export type EmailDelivery = ReturnType<typeof createEmailDelivery>;
