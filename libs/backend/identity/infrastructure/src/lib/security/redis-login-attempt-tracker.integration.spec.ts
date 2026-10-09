import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { createRedisClient, type Redis } from '@taskflow/backend/shared/infrastructure';
import {
  FALLBACK_MAX_ENTRIES,
  LOGIN_FAILURE_TTL_SECONDS,
  RedisLoginAttemptTracker,
} from './redis-login-attempt-tracker';

const T0 = new Date('2026-10-08T12:00:00.000Z');

describe('RedisLoginAttemptTracker (integration, BR-018)', () => {
  let container: StartedTestContainer;
  const clients: Redis[] = [];

  beforeAll(async () => {
    container = await new GenericContainer('redis:8-alpine').withExposedPorts(6379).start();
  });

  afterAll(async () => {
    clients.forEach((client) => client.disconnect());
    await container?.stop();
  });

  async function connected(): Promise<Redis> {
    const redis = createRedisClient({
      redisUrl: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
      connectionName: 'login-attempts-test',
    });
    clients.push(redis);
    await redis.connect();
    return redis;
  }

  function unreachable(): Redis {
    const redis = createRedisClient({
      redisUrl: 'redis://127.0.0.1:1',
      connectionName: 'login-attempts-test',
    });
    redis.on('error', () => undefined);
    clients.push(redis);
    return redis;
  }

  it('counts consecutive failures with the last failure instant and a 24 h TTL', async () => {
    const redis = await connected();
    const tracker = new RedisLoginAttemptTracker(redis);

    await tracker.recordFailure('login:abc', T0);
    await tracker.recordFailure('login:abc', new Date(T0.getTime() + 1_000));

    expect(await tracker.get('login:abc')).toEqual({
      consecutiveFailures: 2,
      lastFailureAt: new Date(T0.getTime() + 1_000),
    });
    const ttl = await redis.ttl('login-failures:login:abc');
    expect(ttl).toBeGreaterThan(LOGIN_FAILURE_TTL_SECONDS - 10);
  });

  it('shares state between API instances and resets on success', async () => {
    const instanceA = new RedisLoginAttemptTracker(await connected());
    const instanceB = new RedisLoginAttemptTracker(await connected());

    await instanceA.recordFailure('login:shared', T0);
    expect((await instanceB.get('login:shared')).consecutiveFailures).toBe(1);

    await instanceB.reset('login:shared');
    expect(await instanceA.get('login:shared')).toEqual({
      consecutiveFailures: 0,
      lastFailureAt: null,
    });
  });

  it('keeps enforcing BR-018 in memory when Redis is unreachable', async () => {
    const onFallback = vi.fn();
    const tracker = new RedisLoginAttemptTracker(unreachable(), onFallback);

    for (let attempt = 0; attempt < 5; attempt += 1)
      await tracker.recordFailure('login:offline', T0);

    expect(await tracker.get('login:offline')).toEqual({
      consecutiveFailures: 5,
      lastFailureAt: T0,
    });
    expect(onFallback).toHaveBeenCalled();
    await tracker.reset('login:offline');
    expect((await tracker.get('login:offline')).consecutiveFailures).toBe(0);
  });

  describe('attempt lease (T29/I2)', () => {
    it('allows a single attempt per account across instances until it is released', async () => {
      const instanceA = new RedisLoginAttemptTracker(await connected());
      const instanceB = new RedisLoginAttemptTracker(await connected());
      const key = `login:${crypto.randomUUID()}`;

      const first = await instanceA.beginAttempt(key, 10_000);
      expect(first).not.toBeNull();
      expect(await instanceB.beginAttempt(key, 10_000)).toBeNull();
      expect(await instanceA.beginAttempt(`login:${crypto.randomUUID()}`, 10_000)).not.toBeNull();

      await first?.release();
      expect(await instanceB.beginAttempt(key, 10_000)).not.toBeNull();
    });

    it('expires on its own, so a crashed process does not lock the account', async () => {
      const tracker = new RedisLoginAttemptTracker(await connected());
      const key = `login:${crypto.randomUUID()}`;

      await tracker.beginAttempt(key, 50);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(await tracker.beginAttempt(key, 10_000)).not.toBeNull();
    });

    it('a late release does not remove the lease of the next attempt', async () => {
      const tracker = new RedisLoginAttemptTracker(await connected());
      const key = `login:${crypto.randomUUID()}`;

      const stale = await tracker.beginAttempt(key, 50);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const current = await tracker.beginAttempt(key, 10_000);
      await stale?.release();

      expect(current).not.toBeNull();
      expect(await tracker.beginAttempt(key, 10_000)).toBeNull();
    });

    it('falls back to an in-process lease while Redis is unavailable', async () => {
      const tracker = new RedisLoginAttemptTracker(unreachable());

      const lease = await tracker.beginAttempt('login:offline', 10_000);
      expect(lease).not.toBeNull();
      expect(await tracker.beginAttempt('login:offline', 10_000)).toBeNull();
      await lease?.release();
      expect(await tracker.beginAttempt('login:offline', 10_000)).not.toBeNull();
    });

    it('keeps the in-memory fallback bounded when Redis is down', async () => {
      const tracker = new RedisLoginAttemptTracker(unreachable());

      for (let index = 0; index <= FALLBACK_MAX_ENTRIES; index += 1) {
        await tracker.recordFailure(`login:${index}`, T0);
      }

      // A mais antiga foi descartada; a mais recente continua contada.
      expect((await tracker.get('login:0')).consecutiveFailures).toBe(0);
      expect((await tracker.get(`login:${FALLBACK_MAX_ENTRIES}`)).consecutiveFailures).toBe(1);
    });
  });
});
