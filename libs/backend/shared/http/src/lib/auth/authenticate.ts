import type { Request, RequestHandler } from 'express';
import type { Actor, RequestContext } from '@taskflow/backend/shared/application';
import { readCookie } from '../cookies/cookies';
import { HttpError } from '../errors/http-error';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- extensão oficial de tipos do Express
  namespace Express {
    interface Request {
      /** Usuário autenticado, definido por `createAuthenticate`. */
      actor?: Actor;
    }
  }
}

export interface AuthenticateOptions {
  /** Nome do cookie que transporta o access token (ex.: `__Host-tf_at`). */
  readonly cookieName: string;
  /**
   * Verifica o access token (assinatura, expiração) e a revogação da sessão.
   * Retorna `null` quando inválido; lança apenas em falha de infraestrutura.
   * Implementado no composition root a partir das portas de `identity` (spec 001).
   */
  readonly resolveActor: (accessToken: string) => Promise<Actor | null>;
  /** Quando `false`, requisições anônimas seguem sem `request.actor`. Padrão: `true`. */
  readonly required?: boolean;
}

const unauthenticated = () => new HttpError(401, 'UNAUTHENTICATED', 'Autenticação necessária');

export function createAuthenticate({
  cookieName,
  resolveActor,
  required = true,
}: AuthenticateOptions): RequestHandler {
  return async (request, _response, next) => {
    const accessToken = readCookie(request, cookieName);
    const actor = accessToken ? await resolveActor(accessToken) : null;

    if (actor) {
      request.actor = actor;
    } else if (required) {
      throw unauthenticated();
    }
    next();
  };
}

/** Monta o `RequestContext` de uma requisição autenticada para passar ao caso de uso. */
export function requestContextFrom(request: Request): RequestContext {
  if (!request.actor) {
    throw unauthenticated();
  }
  return { requestId: String(request.id), actor: request.actor };
}
