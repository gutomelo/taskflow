import type { TenantRequestContext, TransactionRunner } from '@taskflow/backend/shared/application';
import {
  hasOrganizationPermission,
  VersionConflictError,
  type Clock,
} from '@taskflow/backend/shared/kernel';
import {
  OrganizationName,
  type MembershipRepository,
  type OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import { lockOrganizationAndRereadActor } from '../shared/membership-lock';
import { toOrganizationView, type OrganizationView } from '../shared/organization-views';
import { InsufficientRoleError, OrganizationNotFoundError } from '../shared/organizations-errors';
import type { OrganizationsSecurityEventRecorder } from '../shared/organizations-security-events';

/** Pelo menos um campo (o contrato HTTP também garante). */
export type UpdateOrganizationCommand = Readonly<{
  name?: string;
  membersCanCreateProjects?: boolean;
  version: number;
}>;

export interface UpdateOrganizationDependencies {
  readonly organizations: OrganizationRepository;
  readonly memberships: MembershipRepository;
  readonly transactions: TransactionRunner;
  readonly securityEvents: OrganizationsSecurityEventRecorder;
  readonly clock: Clock;
}

/**
 * RF-05 e BR-024 (spec 006): nome e "membros podem criar projetos". A decisão usa o papel
 * **relido sob o lock da organização** — um admin rebaixado no meio não grava (corrige a decisão
 * pelo papel do middleware herdada da spec 002). BR-008 pela versão enviada.
 */
export class UpdateOrganizationUseCase {
  constructor(private readonly deps: UpdateOrganizationDependencies) {}

  async execute(
    context: TenantRequestContext,
    command: UpdateOrganizationCommand,
  ): Promise<OrganizationView> {
    const { organizationId, organizationRole } = context.tenant;
    const actorUserId = context.actor.userId;
    if (!hasOrganizationPermission(organizationRole, 'organization:update'))
      throw new InsufficientRoleError();
    const name = command.name === undefined ? null : OrganizationName.create(command.name);

    const outcome = await this.deps.transactions.run(async () => {
      const actor = await lockOrganizationAndRereadActor(this.deps, organizationId, actorUserId);
      if (!hasOrganizationPermission(actor.role, 'organization:update'))
        throw new InsufficientRoleError();
      const organization = await this.deps.organizations.findById(organizationId);
      if (!organization) throw new OrganizationNotFoundError();
      if (organization.version !== command.version) throw new VersionConflictError('Organization');

      const now = this.deps.clock.now();
      const previous = organization.settings.membersCanCreateProjects;
      if (name) organization.rename(name, now);
      const settingsChanged =
        command.membersCanCreateProjects !== undefined &&
        organization.updateSettings(
          { membersCanCreateProjects: command.membersCanCreateProjects },
          now,
        );
      await this.deps.organizations.save(organization);
      return { organization, actorRole: actor.role, settingsChanged, previous };
    });

    if (outcome.settingsChanged) {
      this.deps.securityEvents.record({
        type: 'organizations.settings_changed',
        requestId: context.requestId,
        organizationId,
        actorUserId,
        membersCanCreateProjects: { from: outcome.previous, to: !outcome.previous },
      });
    }
    // `save` grava `version + 1`; capacidades com o papel relido.
    const view = toOrganizationView(outcome.organization, outcome.actorRole);
    return { ...view, version: view.version + 1 };
  }
}
