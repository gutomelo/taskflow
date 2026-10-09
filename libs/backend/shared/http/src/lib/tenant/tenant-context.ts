import type { Request, RequestHandler } from 'express';
import {
  isOrganizationRole,
  type Tenant,
  type TenantRequestContext,
} from '@taskflow/backend/shared/application';
import { requestContextFrom } from '../auth/authenticate';
import { HttpError } from '../errors/http-error';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- extensão oficial de tipos do Express
  namespace Express {
    interface Request {
      /** Organização ativa validada, definida por `createTenantContext` (ADR 0012). */
      tenant?: Tenant;
    }
  }
}

export interface TenantContextOptions {
  /**
   * Membership do usuário na organização (uma consulta indexada, sem cache). `null` quando não
   * há membership ou a organização não existe — o chamador não distingue os dois casos.
   */
  readonly resolve: (input: {
    readonly userId: string;
    readonly organizationId: string;
  }) => Promise<{ readonly organizationRole: string } | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mesma resposta para organização inexistente, sem membership ou id malformado (sem oráculo). */
const organizationNotFound = () =>
  new HttpError(404, 'ORGANIZATION_NOT_FOUND', 'Organização não encontrada');

/**
 * Resolve a organização ativa a partir de `:organizationId` (ADR 0012). Montado uma única vez
 * no composition root sobre `/organizations/:organizationId`, depois de `authenticate` e do CSRF.
 * O id da rota é intenção: só vira `request.tenant` com membership válida.
 */
export function createTenantContext({ resolve }: TenantContextOptions): RequestHandler {
  return async (request, _response, next) => {
    const { userId } = requestContextFrom(request).actor; // 401 sem sessão
    const raw = request.params['organizationId'];
    // Antes de consultar: um id fora do formato UUID viraria erro do banco (500).
    if (typeof raw !== 'string' || !UUID.test(raw)) throw organizationNotFound();
    const organizationId = raw.toLowerCase();

    const membership = await resolve({ userId, organizationId });
    if (!membership) throw organizationNotFound();
    if (!isOrganizationRole(membership.organizationRole)) {
      // Dado inconsistente no banco: nega (fail closed) e deixa rastro para investigação.
      request.log.error({ organizationId, userId }, 'Unknown organization role; access denied');
      throw organizationNotFound();
    }
    request.tenant = { organizationId, organizationRole: membership.organizationRole };
    next();
  };
}

/**
 * Único jeito de obter o contexto tenant-scoped num controller. Falha fechado (500 genérico) se a
 * rota não passou por `createTenantContext` — nunca monta o tenant a partir da URL.
 */
export function tenantRequestContextFrom(request: Request): TenantRequestContext {
  const context = requestContextFrom(request);
  if (!request.tenant) {
    throw new Error('tenantRequestContextFrom used on a route without createTenantContext');
  }
  return { ...context, tenant: request.tenant };
}
