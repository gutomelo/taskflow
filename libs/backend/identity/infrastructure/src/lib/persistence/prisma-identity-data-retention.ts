import type { IdentityDataRetention } from '@taskflow/backend/identity/application';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';

/** Linhas por lote: transações curtas e locks breves mesmo com muito volume vencido. */
const DEFAULT_BATCH_SIZE = 1_000;

/**
 * Retenção de identidade por SQL em lotes (cada lote é uma instrução autocommit). Sessões,
 * refresh tokens e tokens de e-mail dependentes de uma conta removida caem por `ON DELETE CASCADE`.
 */
export class PrismaIdentityDataRetention implements IdentityDataRetention {
  constructor(
    private readonly transactions: PrismaTransactionRunner,
    private readonly batchSize = DEFAULT_BATCH_SIZE,
  ) {}

  deleteSessionsEndedBefore(endedBefore: Date): Promise<number> {
    return this.inBatches(
      (client, limit) => client.$executeRaw`
      DELETE FROM sessions WHERE id IN (
        SELECT id FROM sessions
        WHERE revoked_at < ${endedBefore}
          OR idle_expires_at < ${endedBefore}
          OR absolute_expires_at < ${endedBefore}
        LIMIT ${limit})`,
    );
  }

  deleteUserTokensEndedBefore(endedBefore: Date): Promise<number> {
    return this.inBatches(
      (client, limit) => client.$executeRaw`
      DELETE FROM user_tokens WHERE id IN (
        SELECT id FROM user_tokens
        WHERE consumed_at < ${endedBefore} OR expires_at < ${endedBefore}
        LIMIT ${limit})`,
    );
  }

  deleteUnverifiedUsers({
    createdBefore,
    noActivitySince,
  }: {
    readonly createdBefore: Date;
    readonly noActivitySince: Date;
  }): Promise<number> {
    // A condição externa é reavaliada pelo PostgreSQL na linha atual: uma conta verificada
    // entre a seleção e a remoção não é apagada.
    return this.inBatches(
      (client, limit) => client.$executeRaw`
      DELETE FROM users WHERE email_verified_at IS NULL AND id IN (
        SELECT u.id FROM users u
        WHERE u.email_verified_at IS NULL
          AND u.created_at < ${createdBefore}
          AND NOT EXISTS (
            SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.last_used_at >= ${noActivitySince})
        LIMIT ${limit})`,
    );
  }

  private async inBatches(
    deleteBatch: (
      client: ReturnType<PrismaTransactionRunner['client']>,
      limit: number,
    ) => Promise<number>,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await deleteBatch(this.transactions.client(), this.batchSize);
      total += deleted;
      if (deleted < this.batchSize) return total;
    }
  }
}
