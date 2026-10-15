import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { pino } from 'pino';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { startPostgresTestDatabase, type PostgresTestDatabase } from '../../testing';
import { createRedisClient, type Redis } from '../cache/redis-client.factory';
import { createPrismaClient, type PrismaClient } from '../persistence/prisma-client.factory';
import { PrismaTransactionRunner } from '../persistence/prisma-transaction-runner';
import {
  BullMqEventPublisher,
  createEventQueue,
  type OutboxEventPublisher,
  type OutboxEventRecord,
  type OutboxJobData,
} from './bullmq-event-publisher';
import { OutboxRelay } from './outbox-relay';

const ROUTED_TYPE = 'test.email_requested';
const logger = pino({ level: 'silent' });
const clock = { now: () => new Date() };

describe('OutboxRelay (integration)', () => {
  let database: PostgresTestDatabase;
  let redisContainer: StartedTestContainer;
  let redis: Redis;
  const prismaClients: PrismaClient[] = [];
  const queues: Queue<OutboxJobData>[] = [];

  function connectPrisma(): PrismaClient {
    const prisma = createPrismaClient({ databaseUrl: database.connectionUri });
    prismaClients.push(prisma);
    return prisma;
  }

  beforeAll(async () => {
    [database, redisContainer] = await Promise.all([
      startPostgresTestDatabase(),
      new GenericContainer('redis:8-alpine').withExposedPorts(6379).start(),
    ]);
    redis = createRedisClient({
      redisUrl: `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`,
      connectionName: 'outbox-relay-test',
    });
    await redis.connect();
  });

  afterAll(async () => {
    await Promise.all(queues.map((queue) => queue.close()));
    await Promise.all(prismaClients.map((prisma) => prisma.$disconnect()));
    redis?.disconnect();
    await Promise.all([database?.stop(), redisContainer?.stop()]);
  });

  let prisma: PrismaClient;
  let queue: Queue<OutboxJobData>;
  let publisher: BullMqEventPublisher;

  beforeEach(async () => {
    prisma ??= connectPrisma();
    await prisma.outboxEvent.deleteMany();
    // Fila nova por teste: isola contagens e jobIds entre os cenários.
    queue = createEventQueue(`emails-${randomUUID()}`, redis);
    queues.push(queue);
    publisher = new BullMqEventPublisher(new Map([[ROUTED_TYPE, queue]]));
  });

  function relayWith(
    eventPublisher: OutboxEventPublisher,
    client: PrismaClient = prisma,
    batchSize = 50,
  ): OutboxRelay {
    return new OutboxRelay({
      transactions: new PrismaTransactionRunner(client),
      publisher: eventPublisher,
      clock,
      logger,
      batchSize,
      pollIntervalMs: 20,
    });
  }

  async function insertEvents(count: number, type = ROUTED_TYPE): Promise<string[]> {
    const base = Date.now();
    const events = Array.from({ length: count }, (_value, index) => ({
      id: randomUUID(),
      type,
      payload: { userId: `user-${index}` },
      occurredAt: new Date(base + index),
    }));
    await prisma.outboxEvent.createMany({ data: events });
    return events.map((event) => event.id);
  }

  async function pendingCount(): Promise<number> {
    return prisma.outboxEvent.count({ where: { publishedAt: null } });
  }

  async function drain(relay: OutboxRelay): Promise<number> {
    let total = 0;
    for (let published = await relay.relayBatch(); published > 0;) {
      total += published;
      published = await relay.relayBatch();
    }
    return total;
  }

  it('publishes each pending event once, as a job keyed by the event id', async () => {
    const [firstId] = await insertEvents(3);
    const relay = relayWith(publisher);

    expect(await relay.relayBatch()).toBe(3);
    expect(await relay.relayBatch()).toBe(0);

    expect(await pendingCount()).toBe(0);
    expect(await queue.count()).toBe(3);
    const job = await queue.getJob(firstId ?? '');
    expect(job?.name).toBe(ROUTED_TYPE);
    expect(job?.data).toMatchObject({
      eventId: firstId,
      type: ROUTED_TYPE,
      payload: { userId: 'user-0' },
    });
    expect(job?.opts).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 86_400 },
      removeOnFail: { age: 604_800 },
    });
  });

  it('gives concurrent relays disjoint batches, so no event is published twice', async () => {
    await insertEvents(120);
    const publishedBy = { first: [] as string[], second: [] as string[] };
    let releaseFirst: () => void = () => undefined;
    let firstHoldsLocks: () => void = () => undefined;
    const firstLocked = new Promise<void>((resolve) => (firstHoldsLocks = resolve));
    const firstMayFinish = new Promise<void>((resolve) => (releaseFirst = resolve));
    let isFirstBatch = true;

    const recording = (name: keyof typeof publishedBy, hold: boolean): OutboxEventPublisher => ({
      eventTypes: publisher.eventTypes,
      publish: async (events: ReadonlyArray<OutboxEventRecord>) => {
        publishedBy[name].push(...events.map((event) => event.id));
        if (hold && isFirstBatch) {
          isFirstBatch = false;
          firstHoldsLocks();
          await firstMayFinish; // mantém as 50 linhas travadas enquanto o outro relay roda
        }
        await publisher.publish(events);
      },
    });

    // Clientes Prisma distintos: conexões e transações independentes, como dois workers.
    const first = relayWith(recording('first', true), connectPrisma());
    const second = relayWith(recording('second', false), connectPrisma());

    const firstRun = first.relayBatch();
    await firstLocked;
    const secondTotal = await drain(second);
    releaseFirst();
    const firstTotal = (await firstRun) + (await drain(first));

    expect(firstTotal).toBe(50);
    expect(secondTotal).toBe(70);
    const overlap = publishedBy.first.filter((id) => publishedBy.second.includes(id));
    expect(overlap).toEqual([]);
    expect(await queue.count()).toBe(120);
    expect(await pendingCount()).toBe(0);
  });

  it('keeps the batch pending when publishing fails', async () => {
    await insertEvents(2);
    const failing: OutboxEventPublisher = {
      eventTypes: publisher.eventTypes,
      publish: async () => {
        throw new Error('Redis down');
      },
    };

    await expect(relayWith(failing).relayBatch()).rejects.toThrow('Redis down');
    expect(await pendingCount()).toBe(2);

    expect(await relayWith(publisher).relayBatch()).toBe(2);
    expect(await pendingCount()).toBe(0);
  });

  it('does not duplicate jobs when a batch is republished after a lost commit', async () => {
    const ids = await insertEvents(3);
    const events = await prisma.outboxEvent.findMany({ where: { id: { in: ids } } });
    // Primeira tentativa publicou, mas o commit de `published_at` não aconteceu.
    await publisher.publish(events);

    expect(await relayWith(publisher).relayBatch()).toBe(3);

    expect(await queue.count()).toBe(3);
    expect(await pendingCount()).toBe(0);
  });

  it('leaves unrouted event types pending without blocking routed ones', async () => {
    await insertEvents(5, 'future.unknown_event');
    await insertEvents(1);

    expect(await relayWith(publisher, prisma, 3).relayBatch()).toBe(1);

    expect(await queue.count()).toBe(1);
    expect(await pendingCount()).toBe(5);
  });

  it('keeps polling for new events until stopped', async () => {
    await insertEvents(7);
    const relay = relayWith(publisher, prisma, 3);

    relay.start();
    await vi.waitFor(async () => expect(await pendingCount()).toBe(0), { timeout: 5_000 });
    await insertEvents(2);
    await vi.waitFor(async () => expect(await pendingCount()).toBe(0), { timeout: 5_000 });
    await relay.stop();

    await insertEvents(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await pendingCount()).toBe(1);
    expect(await queue.count()).toBe(9);
  });
});
