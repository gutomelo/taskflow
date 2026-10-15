import type { Redis } from 'ioredis';
import type { SessionRevocationList } from '@taskflow/backend/identity/application';

/** ≥ vida do access token (15 min) + tolerância de relógio: depois disso o token expira sozinho. */
export const REVOCATION_TTL_SECONDS = 20 * 60;
const keyFor = (sessionId: string) => `revoked-session:${sessionId}`;

export interface RedisSessionRevocationListOptions {
  readonly redis: Redis;
  /** Fonte da verdade quando o Redis está indisponível (`sessions.revoked_at`). */
  readonly isRevokedInDatabase: (sessionId: string) => Promise<boolean>;
  readonly onFallback?: (error: unknown) => void;
}

/**
 * Lista de revogação (ADR 0005). Gravação falha alto (o caso de uso não deve concluir uma
 * revogação que não chegou à lista); leitura recorre ao banco se o Redis falhar.
 * O Redis deve operar com `maxmemory-policy noeviction` para que chaves nunca sumam.
 */
export class RedisSessionRevocationList implements SessionRevocationList {
  constructor(private readonly options: RedisSessionRevocationListOptions) {}

  async revoke(sessionIds: ReadonlyArray<string>): Promise<void> {
    if (sessionIds.length === 0) return;
    const pipeline = this.options.redis.multi();
    for (const sessionId of sessionIds) {
      pipeline.set(keyFor(sessionId), '1', 'EX', REVOCATION_TTL_SECONDS);
    }
    const results = await pipeline.exec();
    const failure = results?.find(([error]) => error !== null)?.[0];
    if (!results || failure) {
      throw failure ?? new Error('Session revocation was not written to Redis');
    }
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    try {
      return (await this.options.redis.exists(keyFor(sessionId))) === 1;
    } catch (error) {
      this.options.onFallback?.(error);
      return this.options.isRevokedInDatabase(sessionId);
    }
  }
}
