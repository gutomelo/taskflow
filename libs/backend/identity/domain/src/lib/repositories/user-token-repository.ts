import type { UserToken, UserTokenPurpose } from '../token/user-token';

export interface UserTokenRepository {
  /**
   * Grava o token do evento; se o evento já tiver token (retry do worker), substitui hash e
   * validade — vale o link da última tentativa (ADR 0011). Um token já consumido permanece
   * consumido (reentregas nunca reativam links usados).
   */
  upsertForEvent(token: UserToken): Promise<void>;
  /**
   * Consome atomicamente (uso único mesmo sob concorrência). Retorna o dono do token ou
   * `null` se inexistente, de outra finalidade, expirado ou já consumido — sem distinção.
   */
  consume(
    tokenHash: string,
    purpose: UserTokenPurpose,
    now: Date,
    options?: { readonly userId?: string },
  ): Promise<{ readonly userId: string } | null>;
  /**
   * Dono de um token ainda utilizável, **sem consumi-lo** (BR-017: verificar a posse antes
   * de gastar o token). Com `options.userId`, `consume` só consome se o dono for o esperado.
   */
  findOwner(
    tokenHash: string,
    purpose: UserTokenPurpose,
    now: Date,
  ): Promise<{ readonly userId: string } | null>;
  /** Invalida tokens pendentes da finalidade (BR-016). Retorna quantos foram invalidados. */
  invalidatePending(userId: string, purpose: UserTokenPurpose, now: Date): Promise<number>;
}
