import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import type { Redis } from 'ioredis';
import type {
  RateLimitDecision,
  RateLimitPolicy,
  RateLimiter,
} from '@taskflow/backend/shared/application';

/**
 * `RateLimiter` sobre Redis (limites compartilhados entre instâncias da API). Se o Redis
 * estiver indisponível, um limitador em memória por processo assume (`insuranceLimiter`):
 * os limites continuam valendo, apenas não são compartilhados entre instâncias.
 */
export class RedisRateLimiter implements RateLimiter {
  private readonly limiters = new Map<string, RateLimiterRedis>();

  constructor(private readonly redis: Redis) {}

  async consume(policy: RateLimitPolicy, key: string): Promise<RateLimitDecision> {
    try {
      const result = await this.limiterFor(policy).consume(key);
      return { allowed: true, remainingPoints: result.remainingPoints };
    } catch (rejection) {
      if (rejection instanceof RateLimiterRes) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(rejection.msBeforeNext / 1000)),
        };
      }
      throw rejection;
    }
  }

  async reset(policy: RateLimitPolicy, key: string): Promise<void> {
    await this.limiterFor(policy).delete(key);
  }

  private limiterFor(policy: RateLimitPolicy): RateLimiterRedis {
    const existing = this.limiters.get(policy.name);
    if (existing) return existing;

    const limiter = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: `rate-limit:${policy.name}`,
      points: policy.points,
      duration: policy.durationSeconds,
      // Falha rápida quando o Redis não está pronto, delegando ao limitador em memória.
      rejectIfRedisNotReady: true,
      insuranceLimiter: new RateLimiterMemory({
        keyPrefix: `rate-limit-insurance:${policy.name}`,
        points: policy.points,
        duration: policy.durationSeconds,
      }),
    });
    this.limiters.set(policy.name, limiter);
    return limiter;
  }
}
