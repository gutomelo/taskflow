import type { TransactionRunner } from '@taskflow/backend/shared/application';
import {
  EmailAddress,
  VersionConflictError,
  type Clock,
  type IdGenerator,
} from '@taskflow/backend/shared/kernel';
import {
  Password,
  Session,
  type PasswordHasher,
  type SecretTokenGenerator,
  type SessionRepository,
  type UserRepository,
  type User,
} from '@taskflow/backend/identity/domain';
import type { AccessTokenIssuer } from '../ports/access-tokens';
import { toSessionClient, type ClientInfo } from '../shared/client-info';
import { toCurrentUserView, type CurrentUserView } from '../shared/current-user-view';
import { InvalidCredentialsError } from '../shared/identity-errors';

export type LoginCommand = Readonly<{ email: string; password: string; client: ClientInfo }>;

export type LoginResult = Readonly<{
  user: CurrentUserView;
  sessionId: string;
  accessToken: string;
  accessTokenExpiresAt: Date;
  /** Valor bruto entregue no cookie; apenas o hash fica no banco. */
  refreshToken: string;
  /** Validade do cookie de refresh: expiração por inatividade (limitada à absoluta). */
  refreshTokenExpiresAt: Date;
}>;

export interface LoginDependencies {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly passwordHasher: PasswordHasher;
  readonly secretTokens: SecretTokenGenerator;
  readonly accessTokens: AccessTokenIssuer;
  readonly transactions: TransactionRunner;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Hash Argon2id de um valor aleatório, calculado no start: verificação de custo constante. */
  readonly dummyPasswordHash: string;
}

/** RF-05. Login permitido sem e-mail verificado (BR-013 atua só em organizações). */
export class LoginUseCase {
  constructor(private readonly deps: LoginDependencies) {}

  async execute(command: LoginCommand): Promise<LoginResult> {
    const user = await this.authenticate(command.email, command.password);
    await this.rehashIfOutdated(user, command.password);

    const now = this.deps.clock.now();
    const refresh = this.deps.secretTokens.generate();
    const session = Session.start({
      id: this.deps.idGenerator.generate(),
      userId: user.id,
      token: { id: this.deps.idGenerator.generate(), tokenHash: refresh.tokenHash },
      client: toSessionClient(command.client),
      now,
    });
    await this.deps.transactions.run(() => this.deps.sessions.add(session));

    const access = await this.deps.accessTokens.issue({ userId: user.id, sessionId: session.id });
    return {
      user: toCurrentUserView(user),
      sessionId: session.id,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: session.toSnapshot().idleExpiresAt,
    };
  }

  private async authenticate(rawEmail: string, password: string): Promise<User> {
    const email = parseEmailOrNull(rawEmail);
    const user = email ? await this.deps.users.findByEmail(email) : null;

    // Sempre um Argon2 verify (BR-014 / RNF-06): sem conta, contra o hash fictício.
    const valid = await this.deps.passwordHasher.verify(
      user?.passwordHash ?? this.deps.dummyPasswordHash,
      password,
    );
    if (!user || !valid) {
      throw new InvalidCredentialsError();
    }
    return user;
  }

  /** Atualiza parâmetros do hash de forma transparente; falha aqui nunca impede o login. */
  private async rehashIfOutdated(user: User, password: string): Promise<void> {
    if (!this.deps.passwordHasher.needsRehash(user.passwordHash)) return;
    try {
      const newHash = await this.deps.passwordHasher.hash(
        Password.fromVerifiedCredential(password),
      );
      user.rehashPassword(newHash);
      await this.deps.transactions.run(() => this.deps.users.save(user));
    } catch (error) {
      if (!(error instanceof VersionConflictError)) throw error;
      // Outra alteração concorrente no usuário: o rehash fica para o próximo login.
    }
  }
}

/** E-mail malformado não pode ter conta: segue o mesmo caminho de "conta inexistente". */
function parseEmailOrNull(raw: string): EmailAddress | null {
  try {
    return EmailAddress.create(raw);
  } catch {
    return null;
  }
}
