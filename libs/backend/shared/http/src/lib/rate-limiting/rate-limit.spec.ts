import request from 'supertest';
import type { RateLimitDecision, RateLimiter } from '@taskflow/backend/shared/application';
import { createTestApp } from '../testing/test-app';
import { clientIpKey, createRateLimit } from './rate-limit';

const policy = { name: 'test.policy', points: 2, durationSeconds: 60 };

/** Limitador em memória: permite `policy.points` consumos por chave. */
function createFakeLimiter() {
  const consumed = new Map<string, number>();
  const limiter: RateLimiter = {
    async consume(currentPolicy, key): Promise<RateLimitDecision> {
      const used = (consumed.get(key) ?? 0) + 1;
      consumed.set(key, used);
      return used <= currentPolicy.points
        ? { allowed: true, remainingPoints: currentPolicy.points - used }
        : { allowed: false, retryAfterSeconds: 42 };
    },
    async reset(_policy, key) {
      consumed.delete(key);
    },
  };
  return { limiter, consumed };
}

function buildApp(limiter: RateLimiter, key = clientIpKey) {
  return createTestApp((app) => {
    app.set('trust proxy', 1);
    app.post('/login', createRateLimit({ limiter, policy, key }), (_req, res) => {
      res.status(204).end();
    });
    app.get('/ip-key', (req, res) => {
      res.json({ key: clientIpKey(req) ?? null });
    });
  });
}

describe('createRateLimit', () => {
  it('allows requests within the policy and rejects the excess with 429 and Retry-After', async () => {
    const { limiter } = createFakeLimiter();
    const app = buildApp(limiter);

    await request(app).post('/login').set('X-Forwarded-For', '203.0.113.7').expect(204);
    await request(app).post('/login').set('X-Forwarded-For', '203.0.113.7').expect(204);
    const blocked = await request(app)
      .post('/login')
      .set('X-Forwarded-For', '203.0.113.7')
      .expect(429);

    expect(blocked.headers['retry-after']).toBe('42');
    expect(blocked.body.code).toBe('RATE_LIMITED');
  });

  it('skips limiting when the key cannot be derived', async () => {
    const { limiter, consumed } = createFakeLimiter();

    await request(buildApp(limiter, () => undefined))
      .post('/login')
      .expect(204);
    expect(consumed.size).toBe(0);
  });
});

describe('clientIpKey', () => {
  async function keyFor(forwardedFor: string) {
    const { limiter } = createFakeLimiter();
    const response = await request(buildApp(limiter))
      .get('/ip-key')
      .set('X-Forwarded-For', forwardedFor);
    return response.body.key as string;
  }

  it('uses the full IPv4 address, unwrapping IPv4-mapped IPv6', async () => {
    expect(await keyFor('203.0.113.7')).toBe('203.0.113.7');
    expect(await keyFor('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('aggregates IPv6 addresses by /64', async () => {
    const first = await keyFor('2001:db8:1:2:aaaa::1');
    const sameNetwork = await keyFor('2001:0db8:0001:0002:ffff:ffff:ffff:ffff');
    const otherNetwork = await keyFor('2001:db8:1:3::1');

    expect(first).toBe('2001:0db8:0001:0002::/64');
    expect(sameNetwork).toBe(first);
    expect(otherNetwork).not.toBe(first);
  });

  it('only trusts as many proxies as configured (spoofed leftmost entries are ignored)', async () => {
    expect(await keyFor('198.51.100.1, 203.0.113.7')).toBe('203.0.113.7');
  });
});
