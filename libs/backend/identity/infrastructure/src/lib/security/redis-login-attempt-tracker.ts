import type { Redis } from 'ioredis';
import type {
  LoginAttemptTracker,
  LoginFailureState,
} from '@taskflow/backend/identity/application';

/** Falhas são esquecidas 24 h após a última: o histórico não pesa para sempre. */
export const LOGIN_FAILURE_TTL_SECONDS = 24 * 60 * 60;
const keyFor = (accountKey: string) => `login-failures:${accountKey}`;
const EMPTY: LoginFailureState = { consecutiveFailures: 0, lastFailureAt: null };

/**
 * Estado de BR-018 no Redis (compartilhado entre instâncias). Se o Redis falhar, usa um
 * mapa em memória por processo: o atraso continua valendo, apenas sem compartilhamento.
 */
export class RedisLoginAttemptTracker implements LoginAttemptTracker {
  private readonly fallback = new Map<string, LoginFailureState>();

  constructor(
    private readonly redis: Redis,
    private readonly onFallback: (error: unknown) => void = () => undefined,
  ) {}

  async get(accountKey: string): Promise<LoginFailureState> {
    try {
      const fields = await this.redis.hgetall(keyFor(accountKey));
      const failures = Number(fields['failures'] ?? 0);
      const last = fields['last'];
      return { consecutiveFailures: failures, lastFailureAt: last ? new Date(Number(last)) : null };
    } catch (error) {
      this.onFallback(error);
      return this.fallback.get(accountKey) ?? EMPTY;
    }
  }

  async recordFailure(accountKey: string, at: Date): Promise<void> {
    try {
      const key = keyFor(accountKey);
      await this.redis
        .multi()
        .hincrby(key, 'failures', 1)
        .hset(key, 'last', String(at.getTime()))
        .expire(key, LOGIN_FAILURE_TTL_SECONDS)
        .exec();
    } catch (error) {
      this.onFallback(error);
      const current = this.fallback.get(accountKey) ?? EMPTY;
      this.fallback.set(accountKey, {
        consecutiveFailures: current.consecutiveFailures + 1,
        lastFailureAt: at,
      });
    }
  }

  async reset(accountKey: string): Promise<void> {
    this.fallback.delete(accountKey);
    try {
      await this.redis.del(keyFor(accountKey));
    } catch (error) {
      this.onFallback(error);
    }
  }
}
