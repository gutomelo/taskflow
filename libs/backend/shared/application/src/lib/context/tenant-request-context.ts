import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import type { RequestContext } from './request-context';

/**
 * Organização ativa validada no servidor (membership da sessão; ADR 0012). O papel serve para
 * negação rápida; decisões que dependem do estado atual relêem a membership sob lock.
 */
export type Tenant = Readonly<{ organizationId: string; organizationRole: OrganizationRole }>;

/** Contexto dos casos de uso tenant-scoped (specs 002+). */
export type TenantRequestContext = RequestContext & Readonly<{ tenant: Tenant }>;
