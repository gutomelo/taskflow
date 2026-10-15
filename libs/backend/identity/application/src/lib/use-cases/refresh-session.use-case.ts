import type { TransactionRunner } from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import {
  RefreshInProgressError,
  SessionExpiredError,
  SessionRevokedError,
  type RotationOutcome,
  type SecretTokenGenerator,
  type SessionRepository,
} from '@taskflow/backend/identity/domain';
import type { AccessTokenIssuer } from '../ports/access-tokens';
import type { SecurityEventRecorder } from '../ports/security-event-recorder';
import type { SessionRevocationList } from '../ports/session-revocation-list';
import { toSessionClient, type ClientInfo } from '../shared/client-info';

export type RefreshSessionCommand = Readonly<{ refreshToken: string; client: ClientInfo }>;

export type RefreshSessionResult = Readonly<{
  userId: string;
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}>;

export interface RefreshSessionDependencies {
  readonly sessions: SessionRepository;
  readonly secretTokens: SecretTokenGenerator;
  readonly accessTokens: AccessTokenIssuer;
  readonly revocationList: SessionRevocationList;
  readonly securityEvents: SecurityEventRecorder;
  readonly transactions: TransactionRunner;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

type TransactionOutcome =
  | Readonly<{ kind: 'unknown' }>
  | Readonly<{
      kind: RotationOutcome['kind'];
      userId: string;
      sessionId: string;
      idleExpiresAt: Date;
    }>;

/**
 * RF-06 / BR-012 / BR-015. A sessão fica bloqueada durante a decisão; o resultado é gravado
 * e **só depois do commit** convertido em erro — lançar dentro da transação desfaria a marca
 * de tolerância usada ou a revogação por reuso.
 */
export class RefreshSessionUseCase {
  constructor(private readonly deps: RefreshSessionDependencies) {}

  async execute({ refreshToken, client }: RefreshSessionCommand): Promise<RefreshSessionResult> {
    const presentedTokenHash = this.deps.secretTokens.hash(refreshToken);
    const newRefresh = this.deps.secretTokens.generate();

    const outcome = await this.deps.transactions.run(async (): Promise<TransactionOutcome> => {
      const session = await this.deps.sessions.findByRefreshTokenHashForUpdate(presentedTokenHash);
      if (!session) return { kind: 'unknown' };

      const rotation = session.rotate({
        presentedTokenHash,
        newToken: { id: this.deps.idGenerator.generate(), tokenHash: newRefresh.tokenHash },
        client: toSessionClient(client),
        now: this.deps.clock.now(),
      });
      if (rotation.kind === 'reuse_detected') {
        // Antes do commit: se não for possível revogar o access token, nada é confirmado.
        await this.deps.revocationList.revoke([session.id]);
      }
      if (
        rotation.kind === 'rotated' ||
        rotation.kind === 'grace' ||
        rotation.kind === 'reuse_detected'
      ) {
        await this.deps.sessions.save(session);
      }
      return {
        kind: rotation.kind,
        userId: session.userId,
        sessionId: session.id,
        idleExpiresAt: session.toSnapshot().idleExpiresAt,
      };
    });

    switch (outcome.kind) {
      case 'rotated': {
        const access = await this.deps.accessTokens.issue({
          userId: outcome.userId,
          sessionId: outcome.sessionId,
        });
        return {
          userId: outcome.userId,
          sessionId: outcome.sessionId,
          accessToken: access.token,
          accessTokenExpiresAt: access.expiresAt,
          refreshToken: newRefresh.token,
          refreshTokenExpiresAt: outcome.idleExpiresAt,
        };
      }
      case 'grace':
        this.deps.securityEvents.record({
          type: 'auth.refresh_grace_hit',
          userId: outcome.userId,
          sessionId: outcome.sessionId,
        });
        throw new RefreshInProgressError();
      case 'reuse_detected':
        this.deps.securityEvents.record({
          type: 'auth.refresh_reuse_detected',
          userId: outcome.userId,
          sessionId: outcome.sessionId,
        });
        throw new SessionRevokedError();
      case 'expired':
        throw new SessionExpiredError();
      case 'revoked':
      case 'unknown':
        throw new SessionRevokedError();
    }
  }
}
