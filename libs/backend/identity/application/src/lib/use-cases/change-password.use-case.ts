import {
  createIntegrationEvent,
  type OutboxWriter,
  type RequestContext,
  type TransactionRunner,
} from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import {
  Password,
  Session,
  SessionRevokedError,
  type CommonPasswordList,
  type PasswordHasher,
  type SecretTokenGenerator,
  type SessionRepository,
  type UserRepository,
  type UserTokenRepository,
} from '@taskflow/backend/identity/domain';
import type { AccessTokenIssuer } from '../ports/access-tokens';
import type { SecurityEventRecorder } from '../ports/security-event-recorder';
import type { SessionRevocationList } from '../ports/session-revocation-list';
import { toSessionClient, type ClientInfo } from '../shared/client-info';
import { CurrentPasswordIncorrectError } from '../shared/identity-errors';
import { IdentityEventType } from '../shared/identity-events';

export type ChangePasswordCommand = Readonly<{
  currentPassword: string;
  newPassword: string;
  client: ClientInfo;
}>;

/** Credenciais da nova sessão que substitui a atual (cookies reemitidos pela camada HTTP). */
export type ChangePasswordResult = Readonly<{
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}>;

export interface ChangePasswordDependencies {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly userTokens: UserTokenRepository;
  readonly passwordHasher: PasswordHasher;
  readonly commonPasswords: CommonPasswordList;
  readonly secretTokens: SecretTokenGenerator;
  readonly accessTokens: AccessTokenIssuer;
  readonly revocationList: SessionRevocationList;
  readonly securityEvents: SecurityEventRecorder;
  readonly transactions: TransactionRunner;
  readonly outbox: OutboxWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * RF-09 / BR-016. Exige a senha atual. Revoga **todas** as sessões existentes (inclusive a
 * atual) e abre uma nova para quem trocou a senha: uma cópia vazada do refresh atual deixa
 * de valer. Também invalida links de recuperação pendentes e avisa por e-mail.
 */
export class ChangePasswordUseCase {
  constructor(private readonly deps: ChangePasswordDependencies) {}

  async execute(
    context: RequestContext,
    command: ChangePasswordCommand,
  ): Promise<ChangePasswordResult> {
    const user = await this.deps.users.findById(context.actor.userId);
    if (!user) throw new SessionRevokedError();

    // Operações caras fora da transação (Argon2).
    if (!(await this.deps.passwordHasher.verify(user.passwordHash, command.currentPassword))) {
      throw new CurrentPasswordIncorrectError();
    }
    const newPassword = Password.create(command.newPassword, {
      email: user.email,
      commonPasswords: this.deps.commonPasswords,
    });
    const newPasswordHash = await this.deps.passwordHasher.hash(newPassword);
    const refresh = this.deps.secretTokens.generate();

    const { session, revokedSessions } = await this.deps.transactions.run(async () => {
      const now = this.deps.clock.now();
      user.changePassword(newPasswordHash, now);
      await this.deps.users.save(user);

      const revokedIds = await this.deps.sessions.revokeAllForUser(
        user.id,
        'password_changed',
        now,
      );
      await this.deps.revocationList.revoke(revokedIds);

      const replacement = Session.start({
        id: this.deps.idGenerator.generate(),
        userId: user.id,
        token: { id: this.deps.idGenerator.generate(), tokenHash: refresh.tokenHash },
        client: toSessionClient(command.client),
        now,
      });
      await this.deps.sessions.add(replacement);
      await this.deps.userTokens.invalidatePending(user.id, 'password_reset', now);
      await this.deps.outbox.append([
        createIntegrationEvent(
          IdentityEventType.passwordChangedNotice,
          { userId: user.id },
          { idGenerator: this.deps.idGenerator, clock: this.deps.clock },
        ),
      ]);
      return { session: replacement, revokedSessions: revokedIds.length };
    });

    this.deps.securityEvents.record({
      type: 'auth.password_changed',
      userId: user.id,
      revokedSessions,
    });
    const access = await this.deps.accessTokens.issue({ userId: user.id, sessionId: session.id });
    return {
      sessionId: session.id,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: session.toSnapshot().idleExpiresAt,
    };
  }
}
