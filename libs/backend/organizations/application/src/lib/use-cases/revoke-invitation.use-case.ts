import type { TenantRequestContext, TransactionRunner } from '@taskflow/backend/shared/application';
import { hasOrganizationPermission, type Clock } from '@taskflow/backend/shared/kernel';
import {
  canInvite,
  type InvitationRepository,
  type MembershipRepository,
  type OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import { lockOrganizationAndRereadActor } from '../shared/membership-lock';
import { InsufficientRoleError, InvitationNotFoundError } from '../shared/organizations-errors';
import type { OrganizationsSecurityEventRecorder } from '../shared/organizations-security-events';

/**
 * RF-07 / CA-06: revogar impede o aceite. Sob o lock da organização, que o aceite também
 * toma: aceite × revogação concorrentes têm um único vencedor.
 */
export class RevokeInvitationUseCase {
  constructor(
    private readonly deps: {
      readonly organizations: OrganizationRepository;
      readonly memberships: MembershipRepository;
      readonly invitations: InvitationRepository;
      readonly transactions: TransactionRunner;
      readonly securityEvents: OrganizationsSecurityEventRecorder;
      readonly clock: Clock;
    },
  ) {}

  async execute(context: TenantRequestContext, invitationId: string): Promise<void> {
    const { organizationId, organizationRole } = context.tenant;
    const actorUserId = context.actor.userId;
    if (!hasOrganizationPermission(organizationRole, 'member:invite'))
      throw new InsufficientRoleError();

    const role = await this.deps.transactions.run(async () => {
      const actor = await lockOrganizationAndRereadActor(this.deps, organizationId, actorUserId);
      const invitation = await this.deps.invitations.findById(organizationId, invitationId);
      if (!invitation?.isOpen) throw new InvitationNotFoundError();
      const invitedRole = invitation.toSnapshot().role;
      if (!canInvite(actor.role, invitedRole)) throw new InsufficientRoleError();

      invitation.revoke(this.deps.clock.now());
      await this.deps.invitations.save(invitation);
      return invitedRole;
    });

    this.deps.securityEvents.record({
      type: 'organizations.invitation_revoked',
      requestId: context.requestId,
      organizationId,
      actorUserId,
      invitationId,
      role,
    });
  }
}
