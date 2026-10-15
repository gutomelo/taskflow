import type { RequestContext, TransactionRunner } from '@taskflow/backend/shared/application';
import type { Clock } from '@taskflow/backend/shared/kernel';
import type { SessionRepository } from '@taskflow/backend/identity/domain';
import type { SecurityEventRecorder } from '../ports/security-event-recorder';
import type { SessionRevocationList } from '../ports/session-revocation-list';
import { SessionNotFoundError } from '../shared/identity-errors';

export interface RevokeSessionDependencies {
  readonly sessions: SessionRepository;
  readonly revocationList: SessionRevocationList;
  readonly securityEvents: SecurityEventRecorder;
  readonly transactions: TransactionRunner;
  readonly clock: Clock;
}

/**
 * RF-08. Sessão de outro usuário responde como inexistente (404 — sem IDOR nem oráculo).
 * Revogar a sessão atual equivale ao logout. Já revogada: concluído sem nova escrita.
 */
export class RevokeSessionUseCase {
  constructor(private readonly deps: RevokeSessionDependencies) {}

  async execute(context: RequestContext, sessionId: string): Promise<void> {
    const revoked = await this.deps.transactions.run(async () => {
      const session = await this.deps.sessions.findByIdForUpdate(sessionId);
      if (!session || session.userId !== context.actor.userId) {
        throw new SessionNotFoundError();
      }
      if (session.isRevoked) return false;

      await this.deps.revocationList.revoke([session.id]);
      session.revoke('user_revoked', this.deps.clock.now());
      await this.deps.sessions.save(session);
      return true;
    });

    if (revoked) {
      this.deps.securityEvents.record({
        type: 'auth.session_revoked',
        userId: context.actor.userId,
        sessionId,
        reason: 'user_revoked',
      });
    }
  }
}
