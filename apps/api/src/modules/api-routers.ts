import type { RequestHandler, Router } from 'express';
import { createTenantScope, type CsrfProtection } from '@taskflow/backend/shared/http';
import type { OrganizationsModule } from './organizations.module';

/**
 * Tudo o que compõe `/api/v1`. Cada contexto novo (projects, tasks…) entra aqui como campo
 * obrigatório: o tipo força `main.ts` **e** os testes de rotas/isolamento a montá-lo (spec 006).
 */
export interface ApiModules {
  readonly identityRouter: Router;
  readonly authenticate: RequestHandler;
  readonly csrf: CsrfProtection;
  readonly organizations: Pick<OrganizationsModule, 'router' | 'tenantRouter' | 'resolveTenant'>;
}

export interface ComposedApi {
  /** Routers sem organização ativa, montados direto em `/api/v1`. */
  readonly globalRouters: ReadonlyArray<Router>;
  /** Escopo do tenant (ADR 0012): `authenticate → csrf → tenantContext` + routers dos contextos. */
  readonly tenantScope: Router;
  /** Ordem de montagem em `/api/v1`. */
  readonly apiRouters: ReadonlyArray<Router>;
}

/** Composição única das rotas da API: usada por `main.ts` e pelos testes de rotas e isolamento. */
export function composeApiRouters(modules: ApiModules): ComposedApi {
  const globalRouters = [modules.identityRouter, modules.organizations.router];
  const tenantScope = createTenantScope({
    authenticate: modules.authenticate,
    csrf: modules.csrf,
    resolve: modules.organizations.resolveTenant,
    routers: [modules.organizations.tenantRouter],
  });
  return { globalRouters, tenantScope, apiRouters: [...globalRouters, tenantScope] };
}
