import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type {
  LoginAttemptLease,
  LoginAttemptTracker,
  LoginFailureState,
} from '@taskflow/backend/identity/application';

/** Falhas são esquecidas 24 h após a última: o histórico não pesa para sempre. */
export const LOGIN_FAILURE_TTL_SECONDS = 24 * 60 * 60;
const keyFor = (accountKey: string) => `login-failures:${accountKey}`;
const leaseKeyFor = (accountKey: string) => `login-attempt:${accountKey}`;
/** Teto dos mapas em memória (Redis fora): e-mails aleatórios não esgotam a memória (T29). */
export const FALLBACK_MAX_ENTRIES = 10_000;
/** Só o dono apaga a reserva: uma reserva expirada não remove a de outra tentativa. */
const RELEASE_LEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const EMPTY: LoginFailureState = { consecutiveFailures: 0, lastFailureAt: null };

/**
 * Estado de BR-018 no Redis (compartilhado entre instâncias). Se o Redis falhar, usa um
 * mapa em memória por processo: o atraso continua valendo, apenas sem compartilhamento.
 */
export class RedisLoginAttemptTracker implements LoginAttemptTracker {
  private readonly fallback = new Map<string, LoginFailureState>();
  private readonly fallbackLeases = new Map<string, { token: string; until: number }>();

  constructor(
    private readonly redis: Redis,
    private readonly onFallback: (error: unknown) => void = () => undefined,
  ) {}

  async beginAttempt(accountKey: string, ttlMs: number): Promise<LoginAttemptLease | null> {
    const key = leaseKeyFor(accountKey);
    const token = randomUUID();
    try {
      if ((await this.redis.set(key, token, 'PX', ttlMs, 'NX')) !== 'OK') return null;
    } catch (error) {
      this.onFallback(error);
      return this.beginLocalAttempt(accountKey, ttlMs);
    }
    return {
      release: async () => {
        try {
          await this.redis.eval(RELEASE_LEASE, 1, key, token);
        } catch (error) {
          // A reserva expira sozinha (TTL); a conta fica livre em no máximo `ttlMs`.
          this.onFallback(error);
        }
      },
    };
  }

  private beginLocalAttempt(accountKey: string, ttlMs: number): LoginAttemptLease | null {
    const now = Date.now();
    const current = this.fallbackLeases.get(accountKey);
    if (current && current.until > now) return null;
    const token = randomUUID();
    remember(this.fallbackLeases, accountKey, { token, until: now + ttlMs });
    return {
      release: async () => {
        if (this.fallbackLeases.get(accountKey)?.token === token) {
          this.fallbackLeases.delete(accountKey);
        }
      },
    };
  }

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
      remember(this.fallback, accountKey, {
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

/** Insere no fim e descarta as entradas mais antigas acima do teto (ordem de inserção do Map). */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > FALLBACK_MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}
