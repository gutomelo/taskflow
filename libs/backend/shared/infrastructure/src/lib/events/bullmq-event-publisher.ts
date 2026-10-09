import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from '../cache/redis-client.factory';

/** Evento lido da outbox, pronto para publicação. */
export interface OutboxEventRecord {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly payload: unknown;
}

/** Dados de cada job publicado; o consumidor valida `payload` com o schema do tipo. */
export interface OutboxJobData {
  readonly eventId: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly payload: unknown;
}

/** Publica eventos da outbox; deve ser idempotente por `event.id` (o relay pode republicar). */
export interface OutboxEventPublisher {
  /** Tipos que este publicador sabe rotear; os demais permanecem pendentes na outbox. */
  readonly eventTypes: ReadonlyArray<string>;
  publish(events: ReadonlyArray<OutboxEventRecord>): Promise<void>;
}

/**
 * Política de retenção e retry dos jobs (ADR 0011). A retenção por idade mantém o `jobId`
 * no Redis por 24 h após a conclusão: uma republicação do relay nesse período é ignorada.
 */
export const OUTBOX_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
} as const satisfies JobsOptions;

/**
 * Fila de produtor sobre o cliente Redis compartilhado. O cliente falha rápido
 * (`maxRetriesPerRequest: 1`, sem fila offline), como a documentação do BullMQ recomenda
 * para produtores: com Redis fora, a publicação falha e o relay tenta no próximo ciclo.
 */
export function createEventQueue(
  name: string,
  connection: Redis,
  /** Sobrescritas pontuais (ex.: backoff curto em testes); o padrão é `OUTBOX_JOB_OPTIONS`. */
  jobOptions: JobsOptions = {},
): Queue<OutboxJobData> {
  return new Queue<OutboxJobData>(name, {
    connection,
    defaultJobOptions: { ...OUTBOX_JOB_OPTIONS, ...jobOptions },
  });
}

/** Roteia cada tipo de evento para a sua fila BullMQ, com `jobId = event.id` (deduplicação). */
export class BullMqEventPublisher implements OutboxEventPublisher {
  readonly eventTypes: ReadonlyArray<string>;

  constructor(private readonly routes: ReadonlyMap<string, Queue<OutboxJobData>>) {
    this.eventTypes = [...routes.keys()];
  }

  async publish(events: ReadonlyArray<OutboxEventRecord>): Promise<void> {
    const batches = new Map<Queue<OutboxJobData>, OutboxEventRecord[]>();
    for (const event of events) {
      const queue = this.routes.get(event.type);
      if (!queue) {
        throw new Error(`No queue routed for outbox event type "${event.type}"`);
      }
      batches.set(queue, [...(batches.get(queue) ?? []), event]);
    }

    await Promise.all(
      [...batches].map(([queue, batch]) =>
        queue.addBulk(
          batch.map((event) => ({
            name: event.type,
            data: {
              eventId: event.id,
              type: event.type,
              occurredAt: event.occurredAt.toISOString(),
              payload: event.payload,
            },
            opts: { jobId: event.id },
          })),
        ),
      ),
    );
  }
}
