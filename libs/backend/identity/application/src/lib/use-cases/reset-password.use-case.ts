import {
  createIntegrationEvent,
  type OutboxWriter,
  type TransactionRunner,
} from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import {
  InvalidOrExpiredTokenError,
  Password,
  type CommonPasswordList,
  type PasswordHasher,
  type SecretTokenGenerator,
  type SessionRepository,
  type UserRepository,
  type UserTokenRepository,
} from '@taskflow/backend/identity/domain';
import type { SecurityEventRecorder } from '../ports/security-event-recorder';
import type { SessionRevocationList } from '../ports/session-revocation-list';
import { IdentityEventType } from '../shared/identity-events';

export type ResetPasswordCommand = Readonly<{ token: string; newPassword: string }>;

export interface ResetPasswordDependencies {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly userTokens: UserTokenRepository;
  readonly passwordHasher: PasswordHasher;
  readonly commonPasswords: CommonPasswordList;
  readonly secretTokens: SecretTokenGenerator;
  readonly revocationList: SessionRevocationList;
  readonly securityEvents: SecurityEventRecorder;
  readonly transactions: TransactionRunner;
  readonly outbox: OutboxWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * RF-11 / BR-016. A política de senha é validada **antes** de consumir o link (senha fraca
 * não gasta o link). Na transação: consumo atômico condicionado ao dono, nova senha, e-mail
 * marcado como verificado (o link comprova a posse), revogação de todas as sessões e dos
 * demais links de recuperação, aviso por e-mail.
 */
export class ResetPasswordUseCase {
  constructor(private readonly deps: ResetPasswordDependencies) {}

  async execute({ token, newPassword }: ResetPasswordCommand): Promise<void> {
    const tokenHash = this.deps.secretTokens.hash(token);
    const owner = await this.deps.userTokens.findOwner(
      tokenHash,
      'password_reset',
      this.deps.clock.now(),
    );
    const user = owner ? await this.deps.users.findById(owner.userId) : null;
    if (!user) throw new InvalidOrExpiredTokenError();

    const password = Password.create(newPassword, {
      email: user.email,
      commonPasswords: this.deps.commonPasswords,
    });
    const newPasswordHash = await this.deps.passwordHasher.hash(password);

    const revokedSessions = await this.deps.transactions.run(async () => {
      const now = this.deps.clock.now();
      const consumed = await this.deps.userTokens.consume(tokenHash, 'password_reset', now, {
        userId: user.id,
      });
      if (!consumed) throw new InvalidOrExpiredTokenError();

      user.changePassword(newPasswordHash, now);
      user.markEmailVerifiedByReset(now);
      await this.deps.users.save(user);

      const revokedIds = await this.deps.sessions.revokeAllForUser(user.id, 'password_reset', now);
      await this.deps.revocationList.revoke(revokedIds);
      await this.deps.userTokens.invalidatePending(user.id, 'password_reset', now);
      await this.deps.outbox.append([
        createIntegrationEvent(
          IdentityEventType.passwordChangedNotice,
          { userId: user.id },
          { idGenerator: this.deps.idGenerator, clock: this.deps.clock },
        ),
      ]);
      return revokedIds.length;
    });

    this.deps.securityEvents.record({
      type: 'auth.password_reset_completed',
      userId: user.id,
      revokedSessions,
    });
  }
}
