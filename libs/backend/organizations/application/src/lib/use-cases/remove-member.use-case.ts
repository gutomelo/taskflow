import type { TenantRequestContext, TransactionRunner } from '@taskflow/backend/shared/application';
import { VersionConflictError, type Clock } from '@taskflow/backend/shared/kernel';
import {
  canManageMembers,
  canRemove,
  LastOwnerError,
  type InvitationRepository,
  type MembershipRepository,
  type OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import { lockOrganizationAndRereadActor } from '../shared/membership-lock';
import { InsufficientRoleError, MemberNotFoundError } from '../shared/organizations-errors';
import type { OrganizationsSecurityEventRecorder } from '../shared/organizations-security-events';

export type RemoveMemberCommand = Readonly<{ userId: string; version: number }>;

export interface RemoveMemberDependencies {
  readonly organizations: OrganizationRepository;
  readonly memberships: MembershipRepository;
  readonly invitations: InvitationRepository;
  readonly transactions: TransactionRunner;
  readonly securityEvents: OrganizationsSecurityEventRecorder;
  readonly clock: Clock;
}

/**
 * RF-11/RF-12: remover um membro ou sair (alvo = ator), num único caso de uso — a spec 003
 * limpa o acesso a projetos aqui. BR-019/BR-021 sobre o estado relido sob lock; BR-008.
 */
export class RemoveMemberUseCase {
  constructor(private readonly deps: RemoveMemberDependencies) {}

  async execute(context: TenantRequestContext, command: RemoveMemberCommand): Promise<void> {
    const { organizationId, organizationRole } = context.tenant;
    const actorUserId = context.actor.userId;
    const isSelf = command.userId === actorUserId;
    if (!isSelf && !canManageMembers(organizationRole)) throw new InsufficientRoleError();

    const outcome = await this.deps.transactions.run(async () => {
      const actor = await lockOrganizationAndRereadActor(this.deps, organizationId, actorUserId);
      const target = isSelf
        ? actor
        : await this.deps.memberships.find(organizationId, command.userId);
      if (!target) throw new MemberNotFoundError();
      if (target.version !== command.version) throw new VersionConflictError('Membership');
      // BR-019 antes da política, como em `ChangeMemberRoleUseCase` (CA-08).
      if (
        target.role === 'owner' &&
        (await this.deps.memberships.countOwners(organizationId)) <= 1
      ) {
        throw new LastOwnerError();
      }
      if (!canRemove({ actor: actor.role, target: target.role, isSelf })) {
        throw new InsufficientRoleError();
      }

      await this.deps.memberships.remove(organizationId, command.userId, command.version);
      const revokedInvitations = await this.deps.invitations.revokeOpenInvitedBy(
        organizationId,
        command.userId,
        this.deps.clock.now(),
      );
      return { role: target.role, revokedInvitations };
    });

    this.deps.securityEvents.record({
      type: isSelf ? 'organizations.member_left' : 'organizations.member_removed',
      requestId: context.requestId,
      organizationId,
      actorUserId,
      targetUserId: command.userId,
      role: outcome.role,
      revokedInvitations: outcome.revokedInvitations,
    });
  }
}
