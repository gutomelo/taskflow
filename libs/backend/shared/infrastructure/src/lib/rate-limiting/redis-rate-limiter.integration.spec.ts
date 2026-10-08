import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import { createRedisClient, type Redis } from '../cache/redis-client.factory';
import { RedisRateLimiter } from './redis-rate-limiter';

const policy = { name: 'test.login', points: 3, durationSeconds: 60 };

describe('RedisRateLimiter (integration)', () => {
  let container: StartedTestContainer;
  const clients: Redis[] = [];

  function connect(redisUrl: string): Redis {
    const redis = createRedisClient({ redisUrl, connectionName: 'rate-limiter-test' });
    redis.on('error', () => undefined); // Falhas de conexão são cenário de teste.
    clients.push(redis);
    return redis;
  }

  beforeAll(async () => {
    container = await new GenericContainer('redis:8-alpine').withExposedPorts(6379).start();
  });

  afterAll(async () => {
    clients.forEach((client) => client.disconnect());
    await container?.stop();
  });

  async function readyLimiter(): Promise<{ limiter: RedisRateLimiter; redis: Redis }> {
    const redis = connect(`redis://${container.getHost()}:${container.getMappedPort(6379)}`);
    await redis.connect();
    return { limiter: new RedisRateLimiter(redis), redis };
  }

  it('allows up to the policy points and then denies with Retry-After seconds', async () => {
    const { limiter } = await readyLimiter();
    const key = `ip:${crypto.randomUUID()}`;

    const decisions = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      decisions.push(await limiter.consume(policy, key));
    }

    expect(decisions.slice(0, 3).every((decision) => decision.allowed)).toBe(true);
    expect(decisions[3]).toEqual({ allowed: false, retryAfterSeconds: expect.any(Number) });
    const denied = decisions[3];
    if (denied && !denied.allowed) {
      expect(denied.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('shares counters between limiter instances through Redis', async () => {
    const first = await readyLimiter();
    const second = await readyLimiter();
    const key = `ip:${crypto.randomUUID()}`;

    await first.limiter.consume(policy, key);
    await first.limiter.consume(policy, key);
    await second.limiter.consume(policy, key);

    expect((await second.limiter.consume(policy, key)).allowed).toBe(false);
  });

  it('resets a key so the subject can try again', async () => {
    const { limiter } = await readyLimiter();
    const key = `email:${crypto.randomUUID()}`;
    for (let attempt = 0; attempt < 4; attempt += 1) await limiter.consume(policy, key);

    await limiter.reset(policy, key);

    expect((await limiter.consume(policy, key)).allowed).toBe(true);
  });

  it('keeps limiting in memory when Redis is unreachable', async () => {
    const limiter = new RedisRateLimiter(connect('redis://127.0.0.1:1'));
    const key = 'ip:203.0.113.7';

    const decisions = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      decisions.push(await limiter.consume(policy, key));
    }

    expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, false]);
  });
});
