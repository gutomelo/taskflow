import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import { hasOrganizationPermission } from '@taskflow/backend/shared/kernel';
import type { OrganizationRepository } from '@taskflow/backend/organizations/domain';
import { toOrganizationView, type OrganizationView } from '../shared/organization-views';
import { InsufficientRoleError, OrganizationNotFoundError } from '../shared/organizations-errors';

/** Organização ativa vista por qualquer membro, com o papel dele (RF-04). */
export class GetOrganizationUseCase {
  constructor(private readonly deps: { readonly organizations: OrganizationRepository }) {}

  async execute(context: TenantRequestContext): Promise<OrganizationView> {
    // Todos os papéis têm `organization:read` hoje; a checagem mantém a negação por padrão se a
    // matriz mudar (RF-01).
    if (!hasOrganizationPermission(context.tenant.organizationRole, 'organization:read'))
      throw new InsufficientRoleError();
    const organization = await this.deps.organizations.findById(context.tenant.organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    return toOrganizationView(organization, context.tenant.organizationRole);
  }
}
