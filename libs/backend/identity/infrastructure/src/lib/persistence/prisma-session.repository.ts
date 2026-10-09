import type {
  Session,
  SessionRepository,
  SessionRevocationReason,
} from '@taskflow/backend/identity/domain';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';
import { toSession } from './identity-mappers';

/** Os 2 tokens mais recentes = atual + predecessor (UUID v7 desempata criações no mesmo ms). */
const latestTokens = {
  refreshTokens: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    take: 2,
  },
};

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly transactions: PrismaTransactionRunner) {}

  async add(session: Session): Promise<void> {
    const snapshot = session.toSnapshot();
    const tokens = [snapshot.previousToken, snapshot.currentToken].filter(
      (token) => token !== null,
    );
    await this.transactions.client().session.create({
      data: {
        id: snapshot.id,
        userId: snapshot.userId,
        createdAt: snapshot.createdAt,
        lastUsedAt: snapshot.lastUsedAt,
        idleExpiresAt: snapshot.idleExpiresAt,
        absoluteExpiresAt: snapshot.absoluteExpiresAt,
        revokedAt: snapshot.revokedAt,
        revocationReason: snapshot.revocationReason,
        userAgent: snapshot.client.userAgent,
        ipPrefix: snapshot.client.ipPrefix,
        refreshTokens: { create: tokens.map((token) => ({ ...token })) },
      },
    });
  }

  async findByRefreshTokenHashForUpdate(tokenHash: string): Promise<Session | null> {
    const transaction = this.transactions.transactionalClient(
      'SessionRepository.findByRefreshTokenHashForUpdate',
    );
    // Bloqueia a linha da sessão: renovações concorrentes do mesmo token esperam aqui e
    // relêem o estado já rotacionado (BR-012).
    const locked = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT s.id
      FROM sessions s
      JOIN refresh_tokens rt ON rt.session_id = s.id
      WHERE rt.token_hash = ${tokenHash}
      FOR UPDATE OF s`;
    const sessionId = locked[0]?.id;
    if (!sessionId) return null;

    return this.load(sessionId);
  }

  async findById(sessionId: string): Promise<Session | null> {
    return this.load(sessionId);
  }

  async listActiveByUser(userId: string, now: Date): Promise<ReadonlyArray<Session>> {
    const rows = await this.transactions.client().session.findMany({
      where: {
        userId,
        revokedAt: null,
        idleExpiresAt: { gt: now },
        absoluteExpiresAt: { gt: now },
      },
      include: latestTokens,
      orderBy: { lastUsedAt: 'desc' },
    });
    return rows.map(({ refreshTokens, ...row }) => toSession(row, refreshTokens));
  }

  async save(session: Session): Promise<void> {
    const snapshot = session.toSnapshot();
    await this.transactions.run(async () => {
      const client = this.transactions.client();
      await client.session.update({
        where: { id: snapshot.id },
        data: {
          lastUsedAt: snapshot.lastUsedAt,
          idleExpiresAt: snapshot.idleExpiresAt,
          revokedAt: snapshot.revokedAt,
          revocationReason: snapshot.revocationReason,
          userAgent: snapshot.client.userAgent,
          ipPrefix: snapshot.client.ipPrefix,
        },
      });
      // Ordem importa: marcar o antigo como rotacionado antes de inserir o novo atual,
      // senão o índice único "um token atual por sessão" é violado.
      if (snapshot.previousToken) {
        await client.refreshToken.update({
          where: { id: snapshot.previousToken.id },
          data: {
            rotatedAt: snapshot.previousToken.rotatedAt,
            graceUsedAt: snapshot.previousToken.graceUsedAt,
          },
        });
      }
      const { id, ...current } = snapshot.currentToken;
      await client.refreshToken.upsert({
        where: { id },
        create: { id, ...current, sessionId: snapshot.id },
        update: { rotatedAt: current.rotatedAt, graceUsedAt: current.graceUsedAt },
      });
    });
  }

  async revokeAllForUser(
    userId: string,
    reason: SessionRevocationReason,
    now: Date,
    options: { readonly exceptSessionId?: string } = {},
  ): Promise<ReadonlyArray<string>> {
    const exceptSessionId = options.exceptSessionId ?? null;
    const revoked = await this.transactions.client().$queryRaw<Array<{ id: string }>>`
      UPDATE sessions
      SET revoked_at = ${now}, revocation_reason = ${reason}::session_revocation_reason
      WHERE user_id = ${userId}::uuid
        AND revoked_at IS NULL
        AND (${exceptSessionId}::uuid IS NULL OR id <> ${exceptSessionId}::uuid)
      RETURNING id`;
    return revoked.map(({ id }) => id);
  }

  private async load(sessionId: string): Promise<Session | null> {
    const row = await this.transactions.client().session.findUnique({
      where: { id: sessionId },
      include: latestTokens,
    });
    if (!row) return null;
    const { refreshTokens, ...session } = row;
    return toSession(session, refreshTokens);
  }
}
