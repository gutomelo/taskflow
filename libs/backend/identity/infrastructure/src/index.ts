export { PrismaUserRepository } from './lib/persistence/prisma-user.repository';
export { PrismaSessionRepository } from './lib/persistence/prisma-session.repository';
export { PrismaUserTokenRepository } from './lib/persistence/prisma-user-token.repository';
export {
  Argon2PasswordHasher,
  ARGON2_PARAMETERS,
  type Argon2PasswordHasherOptions,
} from './lib/security/argon2-password-hasher';
export { ConcurrencyLimiter } from './lib/security/concurrency-limiter';
export { FileCommonPasswordList } from './lib/security/file-common-password-list';
export {
  ACCESS_TOKEN_TTL_SECONDS,
  JoseAccessTokens,
  type JoseAccessTokensOptions,
} from './lib/security/jose-access-tokens';
export {
  RedisSessionRevocationList,
  REVOCATION_TTL_SECONDS,
  type RedisSessionRevocationListOptions,
} from './lib/security/redis-session-revocation-list';
export { CryptoSecretTokenGenerator } from './lib/security/crypto-secret-token-generator';
export {
  LOGIN_FAILURE_TTL_SECONDS,
  RedisLoginAttemptTracker,
} from './lib/security/redis-login-attempt-tracker';
export { ptBrIdentityEmailTemplates } from './lib/email/pt-br-identity-email-templates';
