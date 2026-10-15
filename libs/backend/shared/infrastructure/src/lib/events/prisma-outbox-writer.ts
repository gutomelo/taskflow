import type { IntegrationEvent, OutboxWriter } from '@taskflow/backend/shared/application';
import type { PrismaTransactionRunner } from '../persistence/prisma-transaction-runner';

/** Grava eventos na tabela `outbox_events` dentro da transação corrente (ADR 0011). */
export class PrismaOutboxWriter implements OutboxWriter {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async append(events: ReadonlyArray<IntegrationEvent>): Promise<void> {
    if (events.length === 0) return;
    const transaction = this.transactions.transactionalClient('OutboxWriter.append');
    await transaction.outboxEvent.createMany({
      data: events.map((event) => ({
        id: event.id,
        type: event.type,
        payload: event.payload,
        occurredAt: event.occurredAt,
      })),
    });
  }
}
