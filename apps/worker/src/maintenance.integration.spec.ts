import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import {
  createPrismaClient,
  createRedisClient,
  SystemClock,
  type PrismaClient,
  type Redis,
} from '@taskflow/backend/shared/infrastructure';
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from '@taskflow/backend/shared/infrastructure/testing';
import { createMaintenance, DATA_PURGE_JOB_NAME, DATA_PURGE_SCHEDULER_ID } from './maintenance';

const DAY = 24 * 60 * 60 * 1000;

describe('maintenance (integration: PostgreSQL + Redis)', () => {
  let database: PostgresTestDatabase;
  let redisContainer: StartedTestContainer;
  let prisma: PrismaClient;
  let redis: Redis;
  let redisUrl: string;
  const instances: Array<ReturnType<typeof createMaintenance>> = [];

  function maintenance() {
    const instance = createMaintenance({
      prisma,
      redis,
      redisUrl,
      clock: new SystemClock(),
      logger: pino({ level: 'silent' }),
    });
    instances.push(instance);
    return instance;
  }

  beforeAll(async () => {
    [database, redisContainer] = await Promise.all([
      startPostgresTestDatabase(),
      new GenericContainer('redis:8-alpine').withExposedPorts(6379).start(),
    ]);
    prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`;
    redis = createRedisClient({ redisUrl, connectionName: 'maintenance-test' });
    await redis.connect();
  });

  afterAll(async () => {
    await Promise.all(instances.map((instance) => instance.stop()));
    redis?.disconnect();
    await prisma?.$disconnect();
    await Promise.all([database?.stop(), redisContainer?.stop()]);
  });

  it('registers a single daily schedule even when several workers start', async () => {
    const first = maintenance();
    first.start();
    maintenance().start();

    await vi.waitFor(
      async () => {
        const schedulers = await first.queue.getJobSchedulers();
        expect(schedulers).toHaveLength(1);
        expect(schedulers[0]).toMatchObject({
          key: DATA_PURGE_SCHEDULER_ID,
          name: DATA_PURGE_JOB_NAME,
          pattern: '0 0 3 * * *',
          tz: 'UTC',
        });
      },
      { timeout: 10_000 },
    );
    // Sempre um único job agendado para a próxima ocorrência (03:00 UTC).
    expect(await first.queue.getDelayedCount()).toBe(1);
    const [next] = await first.queue.getDelayed();
    expect(new Date((next?.timestamp ?? 0) + (next?.delay ?? 0)).getUTCHours()).toBe(3);
  });

  it('purges expired identity data, closed invitations and published outbox events when the job runs', async () => {
    const now = Date.now();
    const organizationId = randomUUID();
    await prisma.organization.create({
      data: {
        id: organizationId,
        name: 'Acme',
        slug: `acme-${organizationId.slice(0, 8)}`,
        createdAt: new Date(now - 60 * DAY),
        updatedAt: new Date(now - 60 * DAY),
      },
    });
    const invitation = (email: string, data: { revokedAt?: Date; expiresAt: Date }) =>
      prisma.invitation.create({
        data: {
          id: randomUUID(),
          organizationId,
          email,
          role: 'member',
          invitedByUserId: randomUUID(),
          deliveryEventId: randomUUID(),
          createdAt: new Date(now - 45 * DAY),
          updatedAt: new Date(now - 45 * DAY),
          ...data,
        },
      });
    await invitation('revogado@exemplo.com', {
      revokedAt: new Date(now - 31 * DAY),
      expiresAt: new Date(now - 38 * DAY),
    });
    await invitation('pendente@exemplo.com', { expiresAt: new Date(now + DAY) });
    const abandonedId = randomUUID();
    await prisma.user.create({
      data: {
        id: abandonedId,
        email: `abandonada-${abandonedId}@exemplo.com`,
        name: 'Pessoa',
        passwordHash: '$argon2id$fixture',
        passwordChangedAt: new Date(now - 10 * DAY),
        createdAt: new Date(now - 10 * DAY),
      },
    });
    await prisma.outboxEvent.create({
      data: {
        id: randomUUID(),
        type: 'identity.email_verification_requested',
        payload: { userId: abandonedId },
        occurredAt: new Date(now - 10 * DAY),
        publishedAt: new Date(now - 10 * DAY),
      },
    });
    const instance = instances[0] ?? maintenance();
    instance.start();

    const job = await instance.queue.add(DATA_PURGE_JOB_NAME, {});

    await vi.waitFor(
      async () => {
        const finished = await instance.queue.getJob(job.id ?? '');
        expect(finished?.returnvalue).toEqual({
          unverifiedUsers: 1,
          sessions: 0,
          userTokens: 0,
          closedInvitations: 1,
          outboxEvents: 1,
          notifications: 0,
        });
      },
      { timeout: 10_000, interval: 100 },
    );
    expect(await prisma.user.count({ where: { id: abandonedId } })).toBe(0);
    expect(await prisma.outboxEvent.count()).toBe(0);
    expect(
      (await prisma.invitation.findMany({ select: { email: true } })).map((row) => row.email),
    ).toEqual(['pendente@exemplo.com']);
  });
});
