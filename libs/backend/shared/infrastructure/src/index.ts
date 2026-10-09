export type { DependencyProbe } from './lib/health/dependency-probe';
export {
  createPrismaClient,
  createPostgresProbe,
  type PrismaClient,
  type PrismaClientOptions,
} from './lib/persistence/prisma-client.factory';
export {
  PrismaTransactionRunner,
  TransactionRequiredError,
  type PrismaTransactionClient,
  type PrismaTransactionRunnerOptions,
} from './lib/persistence/prisma-transaction-runner';
export { PrismaOutboxWriter } from './lib/events/prisma-outbox-writer';
export { UuidV7Generator } from './lib/identity/uuid-v7-generator';
export { SystemClock } from './lib/time/system-clock';
export { RedisRateLimiter } from './lib/rate-limiting/redis-rate-limiter';
export { SmtpEmailSender, type SmtpEmailSenderOptions } from './lib/email/smtp-email-sender';
export {
  createRedisClient,
  createRedisProbe,
  type Redis,
  type RedisClientOptions,
} from './lib/cache/redis-client.factory';
export { isUniqueConstraintViolation } from './lib/persistence/prisma-errors';
/** Tipos das linhas do banco para os mapeadores dos repositórios (nunca saem da infraestrutura). */
export type {
  OutboxEvent as OutboxEventRow,
  RefreshToken as RefreshTokenRow,
  Session as SessionRow,
  User as UserRow,
  UserToken as UserTokenRow,
} from './generated/prisma/client';
export { HmacPseudonymizer } from './lib/privacy/hmac-pseudonymizer';
export {
  checkReadiness,
  type DependencyCheck,
  type ReadinessReport,
  type ReadinessResult,
} from './lib/health/check-readiness';
export { createLogger, type LoggerOptions, type LogLevel } from './lib/logging/create-logger';
export {
  baseEnvironmentShape,
  InvalidConfigurationError,
  originSchema,
  parseEnvironment,
  portSchema,
} from './lib/config/environment';
