import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import type { OrganizationRepository } from '@taskflow/backend/organizations/domain';
import { toOrganizationView, type OrganizationView } from '../shared/organization-views';
import { OrganizationNotFoundError } from '../shared/organizations-errors';

/** Organização ativa vista por qualquer membro, com o papel dele (RF-04). */
export class GetOrganizationUseCase {
  constructor(private readonly deps: { readonly organizations: OrganizationRepository }) {}

  async execute(context: TenantRequestContext): Promise<OrganizationView> {
    const organization = await this.deps.organizations.findById(context.tenant.organizationId);
    if (!organization) throw new OrganizationNotFoundError();
    return toOrganizationView(organization, context.tenant.organizationRole);
  }
}
