import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { Router } from 'express';
import type { Logger } from 'pino';
import type {
  OutboxWriter,
  Pseudonymizer,
  RateLimiter,
  TransactionRunner,
} from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import type { RequestHandler } from 'express';
import {
  createAuthenticate,
  createCsrfProtection,
  type CsrfProtection,
  type DomainErrorMapping,
} from '@taskflow/backend/shared/http';
import type { PrismaTransactionRunner, Redis } from '@taskflow/backend/shared/infrastructure';
import { Password } from '@taskflow/backend/identity/domain';
import {
  ChangePasswordUseCase,
  ConfirmEmailVerificationUseCase,
  EmailDeliveryThrottle,
  FindUserIdByEmailUseCase,
  GetCurrentUserUseCase,
  GetUserAccountsUseCase,
  SearchUsersAmongUseCase,
  GetUserVerificationStatusUseCase,
  ListSessionsUseCase,
  LoginUseCase,
  LogoutUseCase,
  RefreshSessionUseCase,
  RegisterUserUseCase,
  RequestPasswordResetUseCase,
  ResendEmailVerificationUseCase,
  ResetPasswordUseCase,
  RevokeSessionUseCase,
  type SecurityEventRecorder,
} from '@taskflow/backend/identity/application';
import {
  Argon2PasswordHasher,
  CryptoSecretTokenGenerator,
  FileCommonPasswordList,
  JoseAccessTokens,
  PrismaSessionRepository,
  PrismaUserRepository,
  PrismaUserTokenRepository,
  RedisLoginAttemptTracker,
  RedisSessionRevocationList,
} from '@taskflow/backend/identity/infrastructure';
import {
  ACCESS_TOKEN_COOKIE,
  createIdentityRouter,
  identityErrorMappings,
} from '@taskflow/backend/identity/http';
import type { AppConfig } from '../config/env';

/** Asset copiado para `dist/apps/api/assets` pelo build (project.json). */
export const COMMON_PASSWORDS_PATH = join(__dirname, 'assets', 'common-passwords.txt');

export interface IdentityModuleDependencies {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly redis: Redis;
  readonly transactions: PrismaTransactionRunner & TransactionRunner;
  readonly outbox: OutboxWriter;
  readonly rateLimiter: RateLimiter;
  readonly pseudonymizer: Pseudonymizer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly commonPasswordsPath?: string;
}

export interface IdentityModule {
  readonly router: Router;
  readonly domainErrors: Readonly<Record<string, DomainErrorMapping>>;
  /** Sessão obrigatória e CSRF, reutilizados pelas rotas dos outros contextos (ADR 0012). */
  readonly authenticate: RequestHandler;
  readonly csrf: CsrfProtection;
  /** Consultas expostas a outros contextos (BR-013; `UserDirectory` da spec 002). */
  readonly userVerificationStatus: GetUserVerificationStatusUseCase;
  readonly userAccounts: GetUserAccountsUseCase;
  readonly userIdByEmail: FindUserIdByEmailUseCase;
  /** Spec 010: busca de candidatos a menção entre ids dados. */
  readonly searchUsersAmong: SearchUsersAmongUseCase;
}

/** Composition root do contexto Identity & Access (spec 001). */
export async function createIdentityModule(
  deps: IdentityModuleDependencies,
): Promise<IdentityModule> {
  const { config, logger, transactions, clock, idGenerator } = deps;

  const users = new PrismaUserRepository(transactions);
  const sessions = new PrismaSessionRepository(transactions);
  const userTokens = new PrismaUserTokenRepository(transactions);
  const passwordHasher = new Argon2PasswordHasher({
    maxConcurrent: config.passwordHashConcurrency,
  });
  const commonPasswords = await FileCommonPasswordList.load(
    deps.commonPasswordsPath ?? COMMON_PASSWORDS_PATH,
  );
  const secretTokens = new CryptoSecretTokenGenerator();
  const accessTokens = new JoseAccessTokens({
    keys: config.accessTokenKeys,
    activeKid: config.activeAccessTokenKid,
    clock,
  });
  const revocationList = new RedisSessionRevocationList({
    redis: deps.redis,
    isRevokedInDatabase: (sessionId) => sessions.isRevoked(sessionId),
    onFallback: (error) =>
      logger.warn({ err: error }, 'Revocation list unavailable; using database fallback'),
  });
  const securityEvents: SecurityEventRecorder = {
    record: (event) => logger.warn({ securityEvent: event }, event.type),
  };
  const emailThrottle = new EmailDeliveryThrottle(deps.rateLimiter, deps.pseudonymizer);
  const loginAttempts = new RedisLoginAttemptTracker(deps.redis, (error) =>
    logger.warn({ err: error }, 'Login attempt store unavailable; using in-memory fallback'),
  );
  // Hash de custo real calculado no start: login de conta inexistente leva o mesmo tempo (RNF-06).
  const dummyPasswordHash = await passwordHasher.hash(
    Password.fromVerifiedCredential(randomBytes(32).toString('base64url')),
  );

  const shared = {
    users,
    sessions,
    userTokens,
    transactions,
    outbox: deps.outbox,
    idGenerator,
    clock,
  };
  const resolveActor = async (token: string) => {
    const subject = await accessTokens.verify(token);
    if (!subject || (await revocationList.isRevoked(subject.sessionId))) return null;
    return subject;
  };
  const csrf = createCsrfProtection({
    appOrigin: config.appOrigin,
    secret: config.csrfSecret,
    secureCookie: true,
  });
  const authenticate = createAuthenticate({ cookieName: ACCESS_TOKEN_COOKIE, resolveActor });

  const router = createIdentityRouter({
    useCases: {
      register: new RegisterUserUseCase({
        ...shared,
        passwordHasher,
        commonPasswords,
        emailThrottle,
      }),
      login: new LoginUseCase({
        ...shared,
        passwordHasher,
        secretTokens,
        accessTokens,
        dummyPasswordHash,
        loginAttempts,
        pseudonymizer: deps.pseudonymizer,
      }),
      getCurrentUser: new GetCurrentUserUseCase({ users }),
      logout: new LogoutUseCase({ ...shared, revocationList, secretTokens }),
      refreshSession: new RefreshSessionUseCase({
        ...shared,
        secretTokens,
        accessTokens,
        revocationList,
        securityEvents,
      }),
      listSessions: new ListSessionsUseCase({ sessions, clock }),
      revokeSession: new RevokeSessionUseCase({ ...shared, revocationList, securityEvents }),
      resendEmailVerification: new ResendEmailVerificationUseCase({ ...shared, emailThrottle }),
      confirmEmailVerification: new ConfirmEmailVerificationUseCase({ ...shared, secretTokens }),
      changePassword: new ChangePasswordUseCase({
        ...shared,
        passwordHasher,
        commonPasswords,
        secretTokens,
        accessTokens,
        revocationList,
        securityEvents,
      }),
      requestPasswordReset: new RequestPasswordResetUseCase({ ...shared, emailThrottle }),
      resetPassword: new ResetPasswordUseCase({
        ...shared,
        passwordHasher,
        commonPasswords,
        secretTokens,
        revocationList,
        securityEvents,
      }),
    },
    csrf,
    authenticate,
    authenticateOptional: createAuthenticate({
      cookieName: ACCESS_TOKEN_COOKIE,
      resolveActor,
      required: false,
    }),
    accessTokens,
    pseudonymizer: deps.pseudonymizer,
    rateLimiter: deps.rateLimiter,
  });

  return {
    router,
    domainErrors: identityErrorMappings,
    authenticate,
    csrf,
    userVerificationStatus: new GetUserVerificationStatusUseCase({ users }),
    userAccounts: new GetUserAccountsUseCase({ users }),
    userIdByEmail: new FindUserIdByEmailUseCase({ users }),
    searchUsersAmong: new SearchUsersAmongUseCase({ users }),
  };
}
