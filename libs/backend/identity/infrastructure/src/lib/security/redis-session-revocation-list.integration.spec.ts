import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { createRedisClient, type Redis } from '@taskflow/backend/shared/infrastructure';
import {
  RedisSessionRevocationList,
  REVOCATION_TTL_SECONDS,
} from './redis-session-revocation-list';

describe('RedisSessionRevocationList (integration)', () => {
  let container: StartedTestContainer;
  const clients: Redis[] = [];

  beforeAll(async () => {
    container = await new GenericContainer('redis:8-alpine').withExposedPorts(6379).start();
  });

  afterAll(async () => {
    clients.forEach((client) => client.disconnect());
    await container?.stop();
  });

  async function connectedRedis(): Promise<Redis> {
    const redis = createRedisClient({
      redisUrl: `redis://${container.getHost()}:${container.getMappedPort(6379)}`,
      connectionName: 'revocation-test',
    });
    clients.push(redis);
    await redis.connect();
    return redis;
  }

  function unreachableRedis(): Redis {
    const redis = createRedisClient({
      redisUrl: 'redis://127.0.0.1:1',
      connectionName: 'revocation-test',
    });
    redis.on('error', () => undefined);
    clients.push(redis);
    return redis;
  }

  it('RNF-08: marks sessions as revoked with a TTL covering the access token lifetime', async () => {
    const redis = await connectedRedis();
    const list = new RedisSessionRevocationList({ redis, isRevokedInDatabase: vi.fn() });

    await list.revoke(['session-a', 'session-b']);

    expect(await list.isRevoked('session-a')).toBe(true);
    expect(await list.isRevoked('session-b')).toBe(true);
    expect(await list.isRevoked('session-c')).toBe(false);
    const ttl = await redis.ttl('revoked-session:session-a');
    expect(ttl).toBeGreaterThan(REVOCATION_TTL_SECONDS - 10);
    expect(ttl).toBeLessThanOrEqual(REVOCATION_TTL_SECONDS);
    expect(REVOCATION_TTL_SECONDS).toBeGreaterThanOrEqual(15 * 60 + 5);
  });

  it('falls back to the database when Redis cannot be read', async () => {
    const isRevokedInDatabase = vi.fn(async (sessionId: string) => sessionId === 'revoked-in-db');
    const onFallback = vi.fn();
    const list = new RedisSessionRevocationList({
      redis: unreachableRedis(),
      isRevokedInDatabase,
      onFallback,
    });

    expect(await list.isRevoked('revoked-in-db')).toBe(true);
    expect(await list.isRevoked('active-in-db')).toBe(false);
    expect(isRevokedInDatabase).toHaveBeenCalledTimes(2);
    expect(onFallback).toHaveBeenCalled();
  });

  it('fails loudly when a revocation cannot be written (no silent gap)', async () => {
    const list = new RedisSessionRevocationList({
      redis: unreachableRedis(),
      isRevokedInDatabase: vi.fn(),
    });

    await expect(list.revoke(['session-a'])).rejects.toThrow();
  });

  it('does nothing for an empty revocation batch', async () => {
    const list = new RedisSessionRevocationList({
      redis: unreachableRedis(),
      isRevokedInDatabase: vi.fn(),
    });

    await expect(list.revoke([])).resolves.toBeUndefined();
  });
});
