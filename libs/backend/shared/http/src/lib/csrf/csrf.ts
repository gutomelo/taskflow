import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import { readCookie } from '../cookies/cookies';
import { HttpError } from '../errors/http-error';

export const CSRF_COOKIE_NAME = '__Host-tf_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ANONYMOUS_BINDING = 'anon';

export interface CsrfProtectionOptions {
  /** Origem do frontend (`APP_ORIGIN`), única aceita em mutações. */
  readonly appOrigin: string;
  /** Segredo HMAC (`CSRF_SECRET`, ≥ 32 bytes). */
  readonly secret: string;
  readonly secureCookie: boolean;
}

export interface CsrfProtection {
  /** Emite um novo token vinculado a `binding` (id da sessão ou anônimo) no cookie. */
  issue(response: Response, binding?: string): void;
  /**
   * Middleware para métodos não seguros. `resolveBinding` define a que o token deve estar
   * vinculado; o padrão é a sessão do ator autenticado ou "anon".
   */
  require(resolveBinding?: (request: Request) => Promise<string> | string): RequestHandler;
}

const csrfFailure = () =>
  new HttpError(403, 'CSRF_VALIDATION_FAILED', 'Requisição bloqueada por proteção CSRF');

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

/**
 * Proteção CSRF em duas camadas (design da spec 001):
 * 1. Origem: `Origin`/`Referer` iguais a `APP_ORIGIN`; `Sec-Fetch-Site`, quando presente, `same-origin`.
 * 2. Double-submit assinado: cookie `__Host-tf_csrf` = `valor.HMAC(valor, vínculo)` e header igual.
 */
export function createCsrfProtection({
  appOrigin,
  secret,
  secureCookie,
}: CsrfProtectionOptions): CsrfProtection {
  const sign = (value: string, binding: string) =>
    createHmac('sha256', secret).update(`${value}.${binding}`).digest('base64url');

  const defaultBinding = (request: Request) => request.actor?.sessionId ?? ANONYMOUS_BINDING;

  return {
    issue(response, binding = ANONYMOUS_BINDING) {
      const value = randomBytes(32).toString('base64url');
      response.cookie(CSRF_COOKIE_NAME, `${value}.${sign(value, binding)}`, {
        // Legível pelo Angular para ecoar no header; protegido por SameSite e pelo prefixo __Host-.
        httpOnly: false,
        secure: secureCookie,
        sameSite: 'strict',
        path: '/',
      });
    },

    require(resolveBinding = defaultBinding) {
      return async (request, _response, next) => {
        if (SAFE_METHODS.has(request.method)) {
          next();
          return;
        }

        const fetchSite = request.get('sec-fetch-site');
        if (fetchSite !== undefined && fetchSite !== 'same-origin') {
          throw csrfFailure();
        }

        const origin = request.get('origin');
        const referer = request.get('referer');
        const requestOrigin = origin ?? (referer ? originOf(referer) : undefined);
        if (requestOrigin !== appOrigin) {
          throw csrfFailure();
        }

        const cookieToken = readCookie(request, CSRF_COOKIE_NAME);
        const headerToken = request.get(CSRF_HEADER_NAME);
        if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
          throw csrfFailure();
        }

        const [value, signature, ...rest] = cookieToken.split('.');
        if (!value || !signature || rest.length > 0) {
          throw csrfFailure();
        }
        const binding = await resolveBinding(request);
        if (!safeEqual(signature, sign(value, binding))) {
          throw csrfFailure();
        }
        next();
      };
    },
  };
}
