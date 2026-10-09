import { Router, type RequestHandler } from 'express';
import type { CsrfProtection } from '../csrf/csrf';
import { createTenantContext, type TenantContextOptions } from './tenant-context';

/** Prefixo único dos recursos tenant-scoped (ADR 0012), relativo a `/api/v1`. */
export const TENANT_PATH_PREFIX = '/organizations/:organizationId';

export interface TenantScopeOptions {
  readonly authenticate: RequestHandler;
  readonly csrf: CsrfProtection;
  readonly resolve: TenantContextOptions['resolve'];
  /** Routers dos contextos com caminhos relativos ao prefixo (criados com `mergeParams`). */
  readonly routers: ReadonlyArray<Router>;
}

/**
 * Router de tenant único (ADR 0012): `authenticate → csrf → tenantContext` uma vez sobre o
 * prefixo e, abaixo, os routers dos contextos — protegidos por construção. Montado em `/api/v1`.
 */
export function createTenantScope({
  authenticate,
  csrf,
  resolve,
  routers,
}: TenantScopeOptions): Router {
  const scoped = Router({ mergeParams: true });
  scoped.use(authenticate, csrf.require(), createTenantContext({ resolve }));
  for (const router of routers) {
    scoped.use(router);
  }
  const root = Router();
  root.use(TENANT_PATH_PREFIX, scoped);
  return root;
}
