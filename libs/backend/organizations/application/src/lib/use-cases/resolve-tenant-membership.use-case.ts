import type { Tenant } from '@taskflow/backend/shared/application';
import type { MembershipRepository } from '@taskflow/backend/organizations/domain';

/**
 * ADR 0012 / RF-03: resolvedor do middleware de tenant. Uma consulta pelo único
 * `(organization_id, user_id)`, sem cache; `null` para organização inexistente ou sem membership.
 */
export class ResolveTenantMembershipUseCase {
  constructor(private readonly deps: { readonly memberships: MembershipRepository }) {}

  async execute(input: {
    readonly userId: string;
    readonly organizationId: string;
  }): Promise<Tenant | null> {
    const membership = await this.deps.memberships.find(input.organizationId, input.userId);
    if (!membership) return null;
    const { organizationId, role } = membership.toSnapshot();
    return { organizationId, organizationRole: role };
  }
}
