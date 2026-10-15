import type { RequestContext } from '@taskflow/backend/shared/application';
import type {
  MembershipRepository,
  OrganizationRepository,
} from '@taskflow/backend/organizations/domain';
import { toMyOrganizationView, type MyOrganizationView } from '../shared/organization-views';

/**
 * RF-02: organizações das quais o ator é membro, na ordem em que entrou. Duas consultas, sem
 * N+1: as memberships (no máximo `MAX_MEMBERSHIPS_PER_USER`) e as organizações em lote.
 */
export class ListMyOrganizationsUseCase {
  constructor(
    private readonly deps: {
      readonly organizations: OrganizationRepository;
      readonly memberships: MembershipRepository;
    },
  ) {}

  async execute(context: RequestContext): Promise<MyOrganizationView[]> {
    const memberships = await this.deps.memberships.listForUser(context.actor.userId);
    if (memberships.length === 0) return [];

    const organizations = new Map(
      (
        await this.deps.organizations.findByIds(
          memberships.map((m) => m.toSnapshot().organizationId),
        )
      ).map((organization) => [organization.id, organization]),
    );
    return memberships.flatMap((membership) => {
      const { organizationId, role } = membership.toSnapshot();
      const organization = organizations.get(organizationId);
      // Organização apagada entre as duas leituras: some da lista em vez de falhar.
      return organization ? [toMyOrganizationView(organization, role)] : [];
    });
  }
}
