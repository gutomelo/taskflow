import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import {
  createLogger,
  createPostgresProbe,
  createPrismaClient,
  createRedisClient,
  createRedisProbe,
  InvalidConfigurationError,
  SmtpEmailSender,
  SystemClock,
  UuidV7Generator,
} from '@taskflow/backend/shared/infrastructure';
import { loadWorkerConfig } from './config/env';
import { createEmailDelivery } from './email-delivery';
import { createHealthServer } from './health/health-server';
import { createMaintenance } from './maintenance';

// Composition root do worker: único lugar que lê o ambiente, cria clientes externos e liga
// os processadores: relay da outbox, envio de e-mails e limpeza diária de dados vencidos.

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
  const config = loadWorkerConfig(process.env);
  const logger = await createLogger({
    service: 'taskflow-worker',
    environment: config.environment,
    level: config.logLevel,
  });

  const prisma = createPrismaClient({ databaseUrl: config.databaseUrl });
  const redis = createRedisClient({ redisUrl: config.redisUrl, connectionName: 'taskflow-worker' });
  redis.on('error', (error) => logger.warn({ err: error }, 'Redis connection error'));
  // Redis indisponível não impede o start (readiness reporta); o cliente segue reconectando.
  await redis.connect().catch((error: unknown) => {
    logger.warn({ err: error }, 'Redis unavailable at startup; readiness will report it');
  });

  const healthServer = createHealthServer({
    probes: [createPostgresProbe(prisma), createRedisProbe(redis)],
    timeoutMs: config.healthCheckTimeoutMs,
    logger,
  });
  // Porta ocupada rejeita aqui e encerra o processo pelo catch do bootstrap.
  await new Promise<void>((resolve, reject) => {
    healthServer.once('error', reject);
    healthServer.listen(config.port, config.host, () => {
      healthServer.off('error', reject);
      resolve();
    });
  });
  logger.info({ host: config.host, port: config.port }, 'TaskFlow worker health listening');

  const clock = new SystemClock();
  const emailSender = new SmtpEmailSender({ smtpUrl: config.smtpUrl, from: config.emailFrom });
  const emailDelivery = createEmailDelivery({
    prisma,
    redis,
    redisUrl: config.redisUrl,
    emailSender,
    appUrl: config.appUrl,
    idGenerator: new UuidV7Generator(),
    clock,
    logger,
  });
  emailDelivery.start();
  const maintenance = createMaintenance({
    prisma,
    redis,
    redisUrl: config.redisUrl,
    clock,
    logger,
  });
  maintenance.start();

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

    // Envios, lote da outbox e limpeza em andamento terminam antes de SMTP e conexões fecharem.
    const failures = (await Promise.all([emailDelivery.stop(), maintenance.stop()])).flat();
    emailSender.close();
    const results = await Promise.allSettled([
      closeServer(healthServer),
      prisma.$disconnect(),
      // quit() envia QUIT e exige conexão ativa; sem ela, apenas descarta o cliente.
      redis.status === 'ready' ? redis.quit() : Promise.resolve(redis.disconnect()),
    ]);
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    for (const failure of failures) {
      logger.error({ err: failure }, 'Error while releasing resource');
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
      : `Falha ao iniciar o worker: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
