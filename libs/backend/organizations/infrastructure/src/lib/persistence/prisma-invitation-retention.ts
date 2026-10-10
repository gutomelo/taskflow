import type { InvitationRetention } from '@taskflow/backend/organizations/application';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';

/** Linhas por lote: instruções curtas e locks breves mesmo com muito volume vencido. */
const DEFAULT_BATCH_SIZE = 1_000;

/** Retenção de convites por SQL em lotes, como a de identity (cada lote em autocommit). */
export class PrismaInvitationRetention implements InvitationRetention {
  constructor(
    private readonly transactions: PrismaTransactionRunner,
    private readonly batchSize = DEFAULT_BATCH_SIZE,
  ) {}

  async deleteClosedBefore(closedBefore: Date): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await this.transactions.client().$executeRaw`
        DELETE FROM invitations WHERE id IN (
          SELECT id FROM invitations
          WHERE accepted_at < ${closedBefore}
            OR revoked_at < ${closedBefore}
            OR expires_at < ${closedBefore}
          LIMIT ${this.batchSize})`;
      total += deleted;
      if (deleted < this.batchSize) return total;
    }
  }
}
