import type {
  OrganizationRole,
  OutboxWriter,
  Pseudonymizer,
  RateLimiter,
  TenantRequestContext,
  TransactionRunner,
} from '@taskflow/backend/shared/application';
import { EmailAddress, type Clock, type IdGenerator } from '@taskflow/backend/shared/kernel';
import {
  AlreadyAMemberError,
  assertInvitableRole,
  canInvite,
  canManageMembers,
  Invitation,
  type InvitationRepository,
  type MembershipRepository,
  type OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import type { UserDirectory } from '../ports/user-directory';
import { InvitationDelivery } from '../shared/invitation-delivery';
import { toInvitationView, type InvitationView } from '../shared/invitation-view';
import { lockOrganizationAndRereadActor } from '../shared/membership-lock';
import { InsufficientRoleError } from '../shared/organizations-errors';
import type { OrganizationsSecurityEventRecorder } from '../shared/organizations-security-events';

export type InviteMemberCommand = Readonly<{ email: string; role: OrganizationRole }>;

export interface InviteMemberDependencies {
  readonly organizations: OrganizationRepository;
  readonly memberships: MembershipRepository;
  readonly invitations: InvitationRepository;
  readonly users: UserDirectory;
  readonly rateLimiter: RateLimiter;
  readonly pseudonymizer: Pseudonymizer;
  readonly outbox: OutboxWriter;
  readonly transactions: TransactionRunner;
  readonly securityEvents: OrganizationsSecurityEventRecorder;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** `created` distingue 201 (convite novo) de 200 (reconvite: papel atualizado e reenviado). */
export type InviteMemberResult = Readonly<{ invitation: InvitationView; created: boolean }>;

/**
 * RF-06 (BR-020, BR-021, RNF-04). Mesma resposta para e-mail com ou sem conta. O lock da
 * organização serializa convites ao mesmo e-mail: o segundo encontra o primeiro aberto e vira
 * reconvite (o único parcial do banco nunca dispara entre caminhos que travam).
 */
export class InviteMemberUseCase {
  private readonly delivery: InvitationDelivery;

  constructor(private readonly deps: InviteMemberDependencies) {
    this.delivery = new InvitationDelivery(deps);
  }

  async execute(
    context: TenantRequestContext,
    command: InviteMemberCommand,
  ): Promise<InviteMemberResult> {
    const { organizationId, organizationRole } = context.tenant;
    const actorUserId = context.actor.userId;
    if (!canManageMembers(organizationRole)) throw new InsufficientRoleError();
    const email = EmailAddress.create(command.email);
    const role = assertInvitableRole(command.role);
    await this.delivery.consumeSenderLimits(actorUserId, organizationId);

    const outcome = await this.deps.transactions.run(async () => {
      const actor = await lockOrganizationAndRereadActor(this.deps, organizationId, actorUserId);
      if (!canInvite(actor.role, role)) throw new InsufficientRoleError();
      const existingUserId = await this.deps.users.findUserIdByEmail(email);
      if (existingUserId && (await this.deps.memberships.find(organizationId, existingUserId))) {
        throw new AlreadyAMemberError();
      }
      await this.delivery.consumeOrganizationEmailLimit(organizationId, email);

      const now = this.deps.clock.now();
      const open = await this.deps.invitations.findOpenByEmail(organizationId, email);
      if (open) {
        const { deliveryEventId } = await this.delivery.schedule(organizationId, open.id, email);
        open.redeliver({ deliveryEventId, role, invitedByUserId: actorUserId, now });
        await this.deps.invitations.save(open);
        return { invitation: open, created: false };
      }
      const invitationId = this.deps.idGenerator.generate();
      const { deliveryEventId } = await this.delivery.schedule(organizationId, invitationId, email);
      const invitation = Invitation.create({
        id: invitationId,
        organizationId,
        email,
        role,
        invitedByUserId: actorUserId,
        deliveryEventId,
        now,
      });
      await this.deps.invitations.add(invitation);
      return { invitation, created: true };
    });

    this.deps.securityEvents.record({
      type: outcome.created
        ? 'organizations.invitation_created'
        : 'organizations.invitation_resent',
      requestId: context.requestId,
      organizationId,
      actorUserId,
      invitationId: outcome.invitation.id,
      role,
    });
    const inviter = (await this.deps.users.getAccounts([actorUserId])).get(actorUserId);
    return {
      invitation: toInvitationView(outcome.invitation, inviter, this.deps.clock.now()),
      created: outcome.created,
    };
  }
}
