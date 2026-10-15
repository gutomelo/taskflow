import { isIPv6 } from 'node:net';
import type { Request, RequestHandler } from 'express';
import type { RateLimitPolicy, RateLimiter } from '@taskflow/backend/shared/application';
import { HttpError } from '../errors/http-error';

export interface RateLimitOptions {
  readonly limiter: RateLimiter;
  readonly policy: RateLimitPolicy;
  /** Chave do sujeito limitado; `undefined` pula o limite (ex.: campo ausente). */
  readonly key: (request: Request) => string | undefined;
  /**
   * Chave obrigatória (ex.: por usuário dentro do escopo do tenant, que sempre autentica): sem
   * ela, a montagem está errada — falha fechado (500) em vez de pular o limite em silêncio.
   */
  readonly requireKey?: boolean;
}

export function createRateLimit({
  limiter,
  policy,
  key,
  requireKey = false,
}: RateLimitOptions): RequestHandler {
  return async (request, _response, next) => {
    const subject = key(request);
    if (subject === undefined) {
      if (requireKey)
        throw new Error(`Rate limit ${policy.name} without a key: check the mounting`);
      next();
      return;
    }
    const decision = await limiter.consume(policy, subject);
    if (!decision.allowed) {
      throw new HttpError(429, 'RATE_LIMITED', 'Muitas tentativas. Tente novamente mais tarde.', {
        retryAfterSeconds: decision.retryAfterSeconds,
      });
    }
    next();
  };
}

/**
 * Chave de limite por cliente: IPv4 completo; IPv6 agregado por /64, já que um único
 * cliente costuma controlar o bloco inteiro. O IP vem de `request.ip`, que respeita
 * `trust proxy` — configure-o com o número exato de proxies confiáveis.
 */
export function clientIpKey(request: Request): string | undefined {
  const ip = request.ip;
  if (!ip) return undefined;
  const mapped = ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
  if (!isIPv6(mapped)) return mapped;
  return `${expandIpv6(mapped).slice(0, 4).join(':')}::/64`;
}

function expandIpv6(address: string): string[] {
  const [head = '', tail = ''] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  return [...headGroups, ...Array<string>(Math.max(missing, 0)).fill('0'), ...tailGroups].map(
    (group) => group.padStart(4, '0').toLowerCase(),
  );
}
