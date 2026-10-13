import type { Clock, OrganizationRole } from '@taskflow/backend/shared/kernel';
import type { ProjectMemberRepository } from '@taskflow/backend/projects/domain';

export type OrganizationRoleChange = Readonly<{
  organizationId: string;
  userId: string;
  fromRole: OrganizationRole;
  toRole: OrganizationRole;
}>;

/**
 * BR-027: reage, **na transação de `ChangeMemberRole`** (porta `MembershipRoleChanges` de
 * `organizations`, ligada no composition root), à mudança de papel na organização. Rebaixado a
 * viewer ⇒ todas as participações viram `viewer`, com versão incrementada; promover depois não
 * as restaura. Sem evento próprio: a transação é de outro contexto, e a contagem vai no evento
 * `organizations.member_role_changed`, registrado depois do commit.
 */
export class ApplyOrganizationRoleChangeUseCase {
  constructor(
    private readonly deps: {
      readonly projectMembers: ProjectMemberRepository;
      readonly clock: Clock;
    },
  ) {}

  async execute(
    change: OrganizationRoleChange,
  ): Promise<Readonly<{ affectedProjectParticipations: number }>> {
    if (change.toRole !== 'viewer') return { affectedProjectParticipations: 0 };
    const affectedProjectParticipations = await this.deps.projectMembers.capToViewer(
      change.organizationId,
      change.userId,
      this.deps.clock.now(),
    );
    return { affectedProjectParticipations };
  }
}
