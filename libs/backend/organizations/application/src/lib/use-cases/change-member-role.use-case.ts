import type {
  OrganizationRole,
  TenantRequestContext,
  TransactionRunner,
} from '@taskflow/backend/shared/application';
import {
  VersionConflictError,
  type Clock,
  hasOrganizationPermission,
} from '@taskflow/backend/shared/kernel';
import {
  canChangeRole,
  LastOwnerError,
  RoleChangeNotAllowedError,
  type InvitationRepository,
  type MembershipRepository,
  type OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import type { MembershipRoleChanges } from '../ports/membership-role-changes';
import type { UserDirectory } from '../ports/user-directory';
import { toMemberView, type MemberView } from '../shared/member-view';
import { lockOrganizationAndRereadActor } from '../shared/membership-lock';
import { InsufficientRoleError, MemberNotFoundError } from '../shared/organizations-errors';
import type { OrganizationsSecurityEventRecorder } from '../shared/organizations-security-events';

export type ChangeMemberRoleCommand = Readonly<{
  userId: string;
  role: OrganizationRole;
  version: number;
}>;

export interface ChangeMemberRoleDependencies {
  readonly organizations: OrganizationRepository;
  readonly memberships: MembershipRepository;
  readonly invitations: InvitationRepository;
  readonly users: UserDirectory;
  readonly transactions: TransactionRunner;
  readonly securityEvents: OrganizationsSecurityEventRecorder;
  /** Spec 003: quem reage à mudança de papel na mesma transação (BR-027 em `projects`). */
  readonly membershipRoleChanges: MembershipRoleChanges;
  readonly clock: Clock;
}

/** RF-10 (BR-019, BR-021, BR-008): decisão sobre o estado relido com a organização travada. */
export class ChangeMemberRoleUseCase {
  constructor(private readonly deps: ChangeMemberRoleDependencies) {}

  async execute(
    context: TenantRequestContext,
    command: ChangeMemberRoleCommand,
  ): Promise<MemberView> {
    const { organizationId, organizationRole } = context.tenant;
    const actorUserId = context.actor.userId;
    // Negação rápida: só owner e admin alteram papéis (inclusive o owner que se rebaixa).
    if (!hasOrganizationPermission(organizationRole, 'member:change-role'))
      throw new InsufficientRoleError();

    const outcome = await this.deps.transactions.run(async () => {
      const actor = await lockOrganizationAndRereadActor(this.deps, organizationId, actorUserId);
      const target = await this.deps.memberships.find(organizationId, command.userId);
      if (!target) throw new MemberNotFoundError();
      if (target.version !== command.version) throw new VersionConflictError('Membership');

      const fromRole = target.role;
      // BR-019 antes da política (CA-08: no rebaixamento mútuo, quem perde recebe LAST_OWNER).
      // Seguro: o ator é membro relido sob lock e os papéis já são visíveis a todos os membros.
      const demotesOwner = fromRole === 'owner' && command.role !== 'owner';
      if (demotesOwner && (await this.deps.memberships.countOwners(organizationId)) <= 1) {
        throw new LastOwnerError();
      }
      const allowed = canChangeRole({
        actor: actor.role,
        target: fromRole,
        newRole: command.role,
        isSelf: command.userId === actorUserId,
      });
      if (!allowed) throw new RoleChangeNotAllowedError();
      if (fromRole === command.role) {
        return {
          target,
          fromRole,
          revokedInvitations: 0,
          cappedProjectParticipations: 0,
          changed: false,
          actorRole: actor.role,
        };
      }

      const now = this.deps.clock.now();
      target.changeRole(command.role, now);
      await this.deps.memberships.save(target);
      // Sempre que o papel muda; quem reage decide (`organizations` não conhece BR-027).
      const { affectedProjectParticipations } = await this.deps.membershipRoleChanges.roleChanged({
        organizationId,
        userId: command.userId,
        fromRole,
        toRole: command.role,
      });
      // Quem deixa de poder convidar perde os convites abertos que criou (design, "Convites").
      const revokedInvitations = hasOrganizationPermission(command.role, 'member:invite')
        ? 0
        : await this.deps.invitations.revokeOpenInvitedBy(organizationId, command.userId, now);
      // O papel do ator depois da operação: o novo, se ele alterou o próprio papel.
      const actorRole = command.userId === actorUserId ? command.role : actor.role;
      return {
        target,
        fromRole,
        revokedInvitations,
        cappedProjectParticipations: affectedProjectParticipations,
        changed: true,
        actorRole,
      };
    });

    const {
      target,
      fromRole,
      revokedInvitations,
      cappedProjectParticipations,
      changed,
      actorRole,
    } = outcome;
    if (changed) {
      this.deps.securityEvents.record({
        type: 'organizations.member_role_changed',
        requestId: context.requestId,
        organizationId,
        actorUserId,
        targetUserId: command.userId,
        fromRole,
        toRole: command.role,
        revokedInvitations,
        cappedProjectParticipations,
      });
    }
    const account = (await this.deps.users.getAccounts([command.userId])).get(command.userId);
    // `save` grava `version + 1`; sem mudança, a versão continua a mesma.
    // Ações calculadas com o papel do ator relido sob lock (não o do middleware).
    return toMemberView(
      target,
      account,
      { role: actorRole, userId: actorUserId },
      changed ? target.version + 1 : target.version,
    );
  }
}
