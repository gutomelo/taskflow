import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import type {
  MembershipRepository,
  OrganizationRepository,
} from '@taskflow/backend/organizations/domain';

export type UserMembershipView = Readonly<{
  organizationId: string;
  slug: string;
  role: OrganizationRole;
}>;

/**
 * Consulta para outros contextos (spec 008, resumo por e-mail no worker): as organizações em que a
 * pessoa é membro agora, com slug e papel. Sem rota HTTP; quem chama já sabe de quem é o resumo.
 */
export class ListUserMembershipsUseCase {
  constructor(
    private readonly deps: {
      readonly organizations: OrganizationRepository;
      readonly memberships: MembershipRepository;
    },
  ) {}

  async execute(userId: string): Promise<UserMembershipView[]> {
    const memberships = await this.deps.memberships.listForUser(userId);
    if (memberships.length === 0) return [];
    const organizations = new Map(
      (
        await this.deps.organizations.findByIds(
          memberships.map((membership) => membership.toSnapshot().organizationId),
        )
      ).map((organization) => [organization.id, organization]),
    );
    return memberships.flatMap((membership) => {
      const { organizationId, role } = membership.toSnapshot();
      const organization = organizations.get(organizationId);
      return organization
        ? [{ organizationId, slug: organization.toSnapshot().slug.value, role }]
        : [];
    });
  }
}
