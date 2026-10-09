import type { TransactionRunner } from '@taskflow/backend/shared/application';
import type { Clock } from '@taskflow/backend/shared/kernel';
import type { SecretTokenGenerator, SessionRepository } from '@taskflow/backend/identity/domain';
import type { SessionRevocationList } from '../ports/session-revocation-list';

/** Logout pelo access token (sessão conhecida) ou pelo refresh token (access já expirado). */
export type LogoutCommand = Readonly<{ sessionId: string | null; refreshToken: string | null }>;

export interface LogoutDependencies {
  readonly sessions: SessionRepository;
  readonly revocationList: SessionRevocationList;
  readonly secretTokens: SecretTokenGenerator;
  readonly transactions: TransactionRunner;
  readonly clock: Clock;
}

/** RF-07. Idempotente: sessão desconhecida ou já revogada termina sem erro. */
export class LogoutUseCase {
  constructor(private readonly deps: LogoutDependencies) {}

  async execute({ sessionId, refreshToken }: LogoutCommand): Promise<void> {
    await this.deps.transactions.run(async () => {
      const session = sessionId
        ? await this.deps.sessions.findByIdForUpdate(sessionId)
        : refreshToken
          ? await this.deps.sessions.findByRefreshTokenHashForUpdate(
              this.deps.secretTokens.hash(refreshToken),
            )
          : null;
      if (!session || session.isRevoked) return;

      // Antes do commit: se a lista de revogação falhar, a revogação inteira é desfeita (ADR 0005).
      await this.deps.revocationList.revoke([session.id]);
      session.revoke('logout', this.deps.clock.now());
      await this.deps.sessions.save(session);
    });
  }
}
