import { setTimeout as sleep } from 'node:timers/promises';
import type { Clock } from '@taskflow/backend/shared/kernel';
import type { Logger } from 'pino';
import type { PrismaTransactionRunner } from '../persistence/prisma-transaction-runner';
import type { OutboxEventPublisher, OutboxEventRecord } from './bullmq-event-publisher';

export interface OutboxRelayOptions {
  readonly transactions: PrismaTransactionRunner;
  readonly publisher: OutboxEventPublisher;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly batchSize?: number;
  readonly pollIntervalMs?: number;
}

/**
 * Relay da Transactional Outbox (ADR 0011): move eventos de `outbox_events` para as filas.
 *
 * Cada lote roda numa transação curta: `FOR UPDATE SKIP LOCKED` dá lotes disjuntos a relays
 * concorrentes; a publicação acontece com as linhas travadas e `published_at` só é gravado
 * depois dela. Se o commit falhar após publicar, o lote volta a ser publicado e o BullMQ
 * descarta os `jobId` repetidos — entrega pelo menos uma vez, sem duplicar jobs.
 */
export class OutboxRelay {
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private abortController: AbortController | undefined;
  private loop: Promise<void> | undefined;

  constructor(private readonly options: OutboxRelayOptions) {
    this.batchSize = options.batchSize ?? 50;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
  }

  /** Publica um lote; devolve quantos eventos foram publicados. */
  relayBatch(): Promise<number> {
    const { transactions, publisher, clock } = this.options;
    // Só busca tipos roteáveis: eventos de um produtor mais novo esperam um worker que os
    // conheça (deploy gradual) sem bloquear os demais.
    const eventTypes = [...publisher.eventTypes];
    if (eventTypes.length === 0) return Promise.resolve(0);

    return transactions.run(async () => {
      const transaction = transactions.transactionalClient('OutboxRelay.relayBatch');
      const events = await transaction.$queryRaw<OutboxEventRecord[]>`
        SELECT id, type, payload, occurred_at AS "occurredAt"
        FROM outbox_events
        WHERE published_at IS NULL AND type = ANY(${eventTypes}::text[])
        ORDER BY occurred_at, id
        LIMIT ${this.batchSize}
        FOR UPDATE SKIP LOCKED`;
      if (events.length === 0) return 0;

      await publisher.publish(events);
      await transaction.outboxEvent.updateMany({
        where: { id: { in: events.map((event) => event.id) } },
        data: { publishedAt: clock.now() },
      });
      return events.length;
    });
  }

  /** Inicia o polling; lotes cheios são drenados em sequência, sem esperar o intervalo. */
  start(): void {
    if (this.loop) return;
    const abortController = new AbortController();
    this.abortController = abortController;
    this.loop = this.run(abortController.signal);
  }

  /** Interrompe o polling e aguarda o lote em andamento terminar. */
  async stop(): Promise<void> {
    this.abortController?.abort();
    await this.loop;
    this.loop = undefined;
    this.abortController = undefined;
  }

  private async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      let published = 0;
      try {
        published = await this.relayBatch();
      } catch (error) {
        this.options.logger.error({ err: error }, 'Outbox relay batch failed; will retry');
      }
      if (published > 0) {
        this.options.logger.debug({ published }, 'Outbox events published');
      }
      if (published < this.batchSize) {
        await sleep(this.pollIntervalMs, undefined, { signal }).catch(() => undefined);
      }
    }
  }
}
