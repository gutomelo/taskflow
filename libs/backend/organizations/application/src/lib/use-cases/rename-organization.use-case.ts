import type { TenantRequestContext, TransactionRunner } from '@taskflow/backend/shared/application';
import { VersionConflictError, type Clock } from '@taskflow/backend/shared/kernel';
import {
  canManageMembers,
  OrganizationName,
  type OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import { toOrganizationView, type OrganizationView } from '../shared/organization-views';
import { InsufficientRoleError, OrganizationNotFoundError } from '../shared/organizations-errors';

export type RenameOrganizationCommand = Readonly<{ name: string; version: number }>;

/**
 * RF-05: owner e admin editam o nome. Não mexe em memberships, então basta o papel resolvido
 * nesta requisição pelo middleware (sem o lock da organização). BR-008 pela versão enviada.
 */
export class RenameOrganizationUseCase {
  constructor(
    private readonly deps: {
      readonly organizations: OrganizationRepository;
      readonly transactions: TransactionRunner;
      readonly clock: Clock;
    },
  ) {}

  async execute(
    context: TenantRequestContext,
    command: RenameOrganizationCommand,
  ): Promise<OrganizationView> {
    if (!canManageMembers(context.tenant.organizationRole)) throw new InsufficientRoleError();
    const name = OrganizationName.create(command.name);

    return this.deps.transactions.run(async () => {
      const organization = await this.deps.organizations.findById(context.tenant.organizationId);
      if (!organization) throw new OrganizationNotFoundError();
      if (organization.version !== command.version) throw new VersionConflictError('Organization');

      organization.rename(name, this.deps.clock.now());
      await this.deps.organizations.save(organization);
      // `save` grava `version + 1` (optimistic locking); a resposta devolve a versão nova.
      const view = toOrganizationView(organization, context.tenant.organizationRole);
      return { ...view, version: view.version + 1 };
    });
  }
}
