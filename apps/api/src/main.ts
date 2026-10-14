import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import {
  createPostgresProbe,
  createPrismaClient,
  createRedisClient,
  createLogger,
  createRedisProbe,
  HmacPseudonymizer,
  InvalidConfigurationError,
  PrismaOutboxWriter,
  PrismaTransactionRunner,
  RedisRateLimiter,
  SystemClock,
  UuidV7Generator,
} from '@taskflow/backend/shared/infrastructure';
import { createApp } from './app';
import { loadConfig } from './config/env';
import { createMembershipRoleChanges } from './modules/adapters/membership-role-changes.adapter';
import { createWorkflowStatusUsage } from './modules/adapters/workflow-status-usage.adapter';
import { createContributorChanges } from './modules/adapters/contributor-changes.adapter';
import { createOrganizationAccess } from './modules/adapters/organization-access.adapter';
import { createProjectUserDirectory } from './modules/adapters/project-user-directory.adapter';
import { createUserDirectory } from './modules/adapters/user-directory.adapter';
import { mergeDomainErrors } from './modules/domain-errors';
import { composeApiRouters } from './modules/api-routers';
import { createIdentityModule } from './modules/identity.module';
import { createOrganizationsModule } from './modules/organizations.module';
import { createProjectsFoundation, createProjectsModule } from './modules/projects.module';
import { createTasksFoundation, createTasksModule } from './modules/tasks.module';
import { createProjectAccess } from './modules/adapters/project-access.adapter';
import { createTaskUserDirectory } from './modules/adapters/task-user-directory.adapter';
import { createTaskflowApiDocument } from './openapi';

// Composition root: único lugar que lê o ambiente, cria clientes externos e liga os módulos.

const SHUTDOWN_TIMEOUT_MS = 10_000;

function loadLocalEnvFile(): void {
  // Em produção as variáveis vêm do orquestrador; .env é conveniência de desenvolvimento.
  if (process.env['NODE_ENV'] !== 'production' && existsSync('.env')) {
    process.loadEnvFile('.env');
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeIdleConnections();
  });
}

async function bootstrap(): Promise<void> {
  loadLocalEnvFile();
  const config = loadConfig(process.env);
  const logger = await createLogger({
    service: 'taskflow-api',
    environment: config.environment,
    level: config.logLevel,
  });

  const prisma = createPrismaClient({ databaseUrl: config.databaseUrl });
  const redis = createRedisClient({ redisUrl: config.redisUrl, connectionName: 'taskflow-api' });
  redis.on('error', (error) => logger.warn({ err: error }, 'Redis connection error'));
  // Conecta antes de aceitar requisições: com a fila offline desligada (fail-fast), comandos
  // emitidos durante a conexão preguiçosa falhariam, degradando revogação e rate limit.
  // Redis indisponível não impede o start (readiness reporta); o cliente segue reconectando.
  await redis.connect().catch((error: unknown) => {
    logger.warn({ err: error }, 'Redis unavailable at startup; continuing with fallbacks');
  });

  const transactions = new PrismaTransactionRunner(prisma);
  const shared = {
    logger,
    transactions,
    outbox: new PrismaOutboxWriter(transactions),
    rateLimiter: new RedisRateLimiter(redis),
    pseudonymizer: new HmacPseudonymizer(config.logPseudonymizationKey),
    idGenerator: new UuidV7Generator(),
    clock: new SystemClock(),
  };
  const identity = await createIdentityModule({ ...shared, config, redis });
  // Ordem de montagem (specs 003 e 004): organizations → projects → tasks, montados ao contrário.
  const tasksFoundation = createTasksFoundation(shared);
  const projectsFoundation = createProjectsFoundation({
    ...shared,
    contributorChanges: createContributorChanges(tasksFoundation),
    workflowStatusUsage: createWorkflowStatusUsage(tasksFoundation),
  });
  const organizations = createOrganizationsModule({
    ...shared,
    membershipRoleChanges: createMembershipRoleChanges(projectsFoundation),
    users: createUserDirectory(identity),
    authenticate: identity.authenticate,
    csrf: identity.csrf,
  });
  const projects = createProjectsModule({
    ...shared,
    foundation: projectsFoundation,
    organizationAccess: createOrganizationAccess(organizations),
    users: createProjectUserDirectory(identity),
  });
  const tasks = createTasksModule({
    ...shared,
    foundation: tasksFoundation,
    projectAccess: createProjectAccess(projects),
    users: createTaskUserDirectory(identity),
  });
  // ADR 0012: `authenticate → csrf → tenantContext` uma vez sobre /organizations/:organizationId.
  const { apiRouters } = composeApiRouters({
    identityRouter: identity.router,
    authenticate: identity.authenticate,
    csrf: identity.csrf,
    organizations,
    projects,
    tasks,
  });

  const app = createApp({
    config,
    logger,
    probes: [createPostgresProbe(prisma), createRedisProbe(redis)],
    apiRouters,
    domainErrors: mergeDomainErrors(
      identity.domainErrors,
      organizations.domainErrors,
      projects.domainErrors,
      tasks.domainErrors,
    ),
    // RF-14: documentação interativa apenas fora de produção.
    ...(config.environment === 'production' ? {} : { apiDocument: createTaskflowApiDocument() }),
  });

  const server = app.listen(config.port, config.host, () => {
    logger.info({ host: config.host, port: config.port }, 'TaskFlow API listening');
  });

  let isShuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    const results = await Promise.allSettled([
      closeServer(server),
      prisma.$disconnect(),
      // quit() envia QUIT e exige conexão ativa; sem ela, apenas descarta o cliente.
      redis.status === 'ready' ? redis.quit() : Promise.resolve(redis.disconnect()),
    ]);
    const failures = results.filter((result) => result.status === 'rejected');
    for (const failure of failures) {
      logger.error({ err: failure.reason }, 'Error while releasing resource');
    }
    logger.flush();
    process.exit(failures.length === 0 ? 0 : 1);
  };

  process.once('SIGTERM', (signal) => void shutdown(signal));
  process.once('SIGINT', (signal) => void shutdown(signal));
}

bootstrap().catch((error: unknown) => {
  // Logger pode não existir ainda (ex.: configuração inválida): stderr é o único canal seguro.
  const message =
    error instanceof InvalidConfigurationError
      ? error.message
      : `Falha ao iniciar a API: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
