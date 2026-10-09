import type { PrismaTransactionRunner } from '../persistence/prisma-transaction-runner';

/**
 * Remove eventos já publicados da outbox (ADR 0011: a tabela não cresce indefinidamente e o
 * payload de recuperação de senha, que contém o e-mail, não fica retido). Eventos pendentes
 * nunca são removidos.
 */
export class PrismaOutboxRetention {
  constructor(
    private readonly transactions: PrismaTransactionRunner,
    private readonly batchSize = 1_000,
  ) {}

  async deletePublishedBefore(publishedBefore: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await this.transactions.client().$executeRaw`
        DELETE FROM outbox_events WHERE id IN (
          SELECT id FROM outbox_events
          WHERE published_at IS NOT NULL AND published_at < ${publishedBefore}
          LIMIT ${this.batchSize})`;
      total += deleted;
      if (deleted < this.batchSize) return total;
    }
  }
}
