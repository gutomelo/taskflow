import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import {
  createPostgresProbe,
  createPrismaClient,
  type PrismaClient,
} from '../persistence/prisma-client.factory';
import { createRedisClient, createRedisProbe, type Redis } from '../cache/redis-client.factory';

describe('dependency probes (integration)', () => {
  let postgresContainer: StartedPostgreSqlContainer;
  let redisContainer: StartedTestContainer;
  const clientsToClose: Array<() => Promise<unknown>> = [];

  beforeAll(async () => {
    [postgresContainer, redisContainer] = await Promise.all([
      new PostgreSqlContainer('postgres:18-alpine').start(),
      new GenericContainer('redis:8-alpine').withExposedPorts(6379).start(),
    ]);
  });

  afterAll(async () => {
    await Promise.allSettled(clientsToClose.map((close) => close()));
    await Promise.allSettled([postgresContainer?.stop(), redisContainer?.stop()]);
  });

  function trackPrisma(prisma: PrismaClient): PrismaClient {
    clientsToClose.push(() => prisma.$disconnect());
    return prisma;
  }

  function trackRedis(redis: Redis): Redis {
    clientsToClose.push(async () => redis.disconnect());
    return redis;
  }

  it('reports PostgreSQL as reachable through the Prisma driver adapter', async () => {
    const prisma = trackPrisma(
      createPrismaClient({ databaseUrl: postgresContainer.getConnectionUri() }),
    );

    await expect(
      createPostgresProbe(prisma).check(AbortSignal.timeout(5_000)),
    ).resolves.toBeUndefined();
  });

  it('rejects when PostgreSQL is unreachable', async () => {
    const prisma = trackPrisma(
      createPrismaClient({ databaseUrl: 'postgresql://user:pass@127.0.0.1:1/unreachable' }),
    );

    await expect(createPostgresProbe(prisma).check(AbortSignal.timeout(5_000))).rejects.toThrow();
  });

  it('reports Redis as reachable', async () => {
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    const redis = trackRedis(createRedisClient({ redisUrl, connectionName: 'probe-test' }));

    await expect(
      createRedisProbe(redis).check(AbortSignal.timeout(5_000)),
    ).resolves.toBeUndefined();
  });

  it('handles concurrent checks while the first connection is still being established', async () => {
    const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    const redis = trackRedis(createRedisClient({ redisUrl, connectionName: 'probe-test' }));
    const probe = createRedisProbe(redis);

    const results = await Promise.allSettled([
      probe.check(AbortSignal.timeout(5_000)),
      probe.check(AbortSignal.timeout(5_000)),
      probe.check(AbortSignal.timeout(5_000)),
    ]);

    expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
  });

  it('rejects when Redis is unreachable', async () => {
    const redis = trackRedis(
      createRedisClient({ redisUrl: 'redis://127.0.0.1:1', connectionName: 'probe-test' }),
    );
    redis.on('error', () => undefined); // Erros de conexão são esperados neste cenário.

    await expect(createRedisProbe(redis).check(AbortSignal.timeout(5_000))).rejects.toThrow();
  });
});
