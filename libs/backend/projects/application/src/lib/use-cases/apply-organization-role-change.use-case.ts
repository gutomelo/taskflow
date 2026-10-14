import {
  effectiveProjectRole,
  type Clock,
  type OrganizationRole,
} from '@taskflow/backend/shared/kernel';
import type { ProjectMemberRepository } from '@taskflow/backend/projects/domain';
import type { ProjectContributorChanges } from '../ports/project-contributor-changes';
import { isContributor } from '../shared/contribution';

export type OrganizationRoleChange = Readonly<{
  organizationId: string;
  userId: string;
  fromRole: OrganizationRole;
  toRole: OrganizationRole;
}>;

/**
 * Reage, **na transação de `ChangeMemberRole`** (porta `MembershipRoleChanges` de `organizations`,
 * ligada no composition root), à mudança de papel na organização:
 * - BR-027: rebaixado a viewer ⇒ todas as participações viram `viewer`, com versão incrementada;
 *   promover depois não as restaura;
 * - BR-003 (spec 004): para **qualquer** mudança para member ou viewer, decide com
 *   `effectiveProjectRole` em quais projetos a pessoa ainda contribui e avisa `tasks` (que desfaz as
 *   atribuições nos demais) — inclusive o admin rebaixado a member com participação antiga viewer.
 * Sem evento próprio: a transação é de outro contexto; a contagem de participações vai no evento
 * `organizations.member_role_changed`, registrado depois do commit.
 */
export class ApplyOrganizationRoleChangeUseCase {
  constructor(
    private readonly deps: {
      readonly projectMembers: ProjectMemberRepository;
      readonly contributorChanges: ProjectContributorChanges;
      readonly clock: Clock;
    },
  ) {}

  async execute(
    change: OrganizationRoleChange,
  ): Promise<Readonly<{ affectedProjectParticipations: number }>> {
    const { organizationId, userId, toRole } = change;
    if (toRole === 'owner' || toRole === 'admin') return { affectedProjectParticipations: 0 };
    const affectedProjectParticipations =
      toRole === 'viewer'
        ? await this.deps.projectMembers.capToViewer(organizationId, userId, this.deps.clock.now())
        : 0;
    // Depois do teto: onde a participação ainda dá papel efetivo manager/member.
    const participations = await this.deps.projectMembers.listForUser(organizationId, userId);
    await this.deps.contributorChanges.contributorAccessReduced({
      organizationId,
      userId,
      scope: 'organization',
      stillContributorIn: participations
        .filter((participation) => isContributor(effectiveProjectRole(toRole, participation.role)))
        .map((participation) => participation.projectId),
    });
    return { affectedProjectParticipations };
  }
}
