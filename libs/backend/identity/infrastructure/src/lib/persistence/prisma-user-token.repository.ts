import type {
  UserToken,
  UserTokenPurpose,
  UserTokenRepository,
} from '@taskflow/backend/identity/domain';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';

export class PrismaUserTokenRepository implements UserTokenRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async upsertForEvent(token: UserToken): Promise<void> {
    const snapshot = token.toSnapshot();
    await this.transactions.client().userToken.upsert({
      where: { sourceEventId: snapshot.sourceEventId },
      create: { ...snapshot },
      // Retry do worker: novo token substitui o anterior do mesmo evento (ADR 0011).
      // `consumedAt` é preservado: uma reentrega após o uso nunca reativa o link.
      update: {
        tokenHash: snapshot.tokenHash,
        expiresAt: snapshot.expiresAt,
        createdAt: snapshot.createdAt,
      },
    });
  }

  async consume(
    tokenHash: string,
    purpose: UserTokenPurpose,
    now: Date,
  ): Promise<{ readonly userId: string } | null> {
    // Uma única instrução: dois consumos simultâneos nunca vencem juntos.
    const consumed = await this.transactions.client().$queryRaw<Array<{ user_id: string }>>`
      UPDATE user_tokens
      SET consumed_at = ${now}
      WHERE token_hash = ${tokenHash}
        AND purpose = ${purpose}::user_token_purpose
        AND consumed_at IS NULL
        AND expires_at > ${now}
      RETURNING user_id`;
    const userId = consumed[0]?.user_id;
    return userId ? { userId } : null;
  }

  async invalidatePending(userId: string, purpose: UserTokenPurpose, now: Date): Promise<number> {
    const { count } = await this.transactions.client().userToken.updateMany({
      where: { userId, purpose, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    return count;
  }
}
