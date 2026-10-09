import { EmailAddress } from '@taskflow/backend/shared/kernel';
import {
  PersonName,
  Session,
  User,
  type RefreshTokenRecord,
} from '@taskflow/backend/identity/domain';
import type { RefreshTokenRow, SessionRow, UserRow } from '@taskflow/backend/shared/infrastructure';

export function toUser(row: UserRow): User {
  return User.restore({
    id: row.id,
    email: EmailAddress.create(row.email),
    name: PersonName.create(row.name),
    passwordHash: row.passwordHash,
    emailVerifiedAt: row.emailVerifiedAt,
    passwordChangedAt: row.passwordChangedAt,
    createdAt: row.createdAt,
    version: row.version,
  });
}

function toRefreshTokenRecord(row: RefreshTokenRow): RefreshTokenRecord {
  return {
    id: row.id,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
    rotatedAt: row.rotatedAt,
    graceUsedAt: row.graceUsedAt,
  };
}

/**
 * Reidrata a sessão a partir da linha e dos seus 2 tokens mais recentes: o atual
 * (não rotacionado) e o predecessor imediato (rotacionado mais recentemente).
 */
export function toSession(row: SessionRow, latestTokens: ReadonlyArray<RefreshTokenRow>): Session {
  const current = latestTokens.find((token) => token.rotatedAt === null);
  if (!current) {
    throw new Error(`Session ${row.id} has no current refresh token`);
  }
  const previous = latestTokens.find((token) => token.rotatedAt !== null) ?? null;

  return Session.restore({
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    idleExpiresAt: row.idleExpiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    revokedAt: row.revokedAt,
    revocationReason: row.revocationReason,
    client: { ipPrefix: row.ipPrefix, userAgent: row.userAgent },
    currentToken: toRefreshTokenRecord(current),
    previousToken: previous ? toRefreshTokenRecord(previous) : null,
  });
}
