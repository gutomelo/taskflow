import type {
  OutboxWriter,
  Pseudonymizer,
  RateLimiter,
  TenantRequestContext,
  TransactionRunner,
} from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import {
  canInvite,
  canManageMembers,
  type InvitationRepository,
  type MembershipRepository,
  type OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import { InvitationDelivery } from '../shared/invitation-delivery';
import { lockOrganizationAndRereadActor } from '../shared/membership-lock';
import { InsufficientRoleError, InvitationNotFoundError } from '../shared/organizations-errors';
import type { OrganizationsSecurityEventRecorder } from '../shared/organizations-security-events';

export interface ResendInvitationDependencies {
  readonly organizations: OrganizationRepository;
  readonly memberships: MembershipRepository;
  readonly invitations: InvitationRepository;
  readonly rateLimiter: RateLimiter;
  readonly pseudonymizer: Pseudonymizer;
  readonly outbox: OutboxWriter;
  readonly transactions: TransactionRunner;
  readonly securityEvents: OrganizationsSecurityEventRecorder;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * RF-07 / CA-06: novo link (o anterior deixa de valer já), prazo renovado. Quem reenvia passa a
 * ser o convidante — é ele que o aceite revalida.
 */
export class ResendInvitationUseCase {
  private readonly delivery: InvitationDelivery;

  constructor(private readonly deps: ResendInvitationDependencies) {
    this.delivery = new InvitationDelivery(deps);
  }

  async execute(context: TenantRequestContext, invitationId: string): Promise<void> {
    const { organizationId, organizationRole } = context.tenant;
    const actorUserId = context.actor.userId;
    if (!canManageMembers(organizationRole)) throw new InsufficientRoleError();
    await this.delivery.consumeSenderLimits(actorUserId, organizationId);

    const role = await this.deps.transactions.run(async () => {
      const actor = await lockOrganizationAndRereadActor(this.deps, organizationId, actorUserId);
      const invitation = await this.deps.invitations.findById(organizationId, invitationId);
      if (!invitation?.isOpen) throw new InvitationNotFoundError();
      const { email, role: invitedRole } = invitation.toSnapshot();
      if (!canInvite(actor.role, invitedRole)) throw new InsufficientRoleError();
      await this.delivery.consumeOrganizationEmailLimit(organizationId, email);

      const { deliveryEventId } = await this.delivery.schedule(invitation.id, email);
      invitation.redeliver({
        deliveryEventId,
        invitedByUserId: actorUserId,
        now: this.deps.clock.now(),
      });
      await this.deps.invitations.save(invitation);
      return invitedRole;
    });

    this.deps.securityEvents.record({
      type: 'organizations.invitation_resent',
      requestId: context.requestId,
      organizationId,
      actorUserId,
      invitationId,
      role,
    });
  }
}
