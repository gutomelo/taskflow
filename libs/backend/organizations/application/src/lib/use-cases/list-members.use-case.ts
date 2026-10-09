import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import type { MembershipRepository } from '@taskflow/backend/organizations/domain';
import type { UserDirectory } from '../ports/user-directory';
import { toMemberView, type MemberView } from '../shared/member-view';
import { toPageRequest, type PageQuery } from '../shared/pagination';

/** RF-09: qualquer membro lista os membros, por cursor; contas em uma consulta por página. */
export class ListMembersUseCase {
  constructor(
    private readonly deps: {
      readonly memberships: MembershipRepository;
      readonly users: UserDirectory;
    },
  ) {}

  async execute(
    context: TenantRequestContext,
    query: PageQuery,
  ): Promise<{ items: MemberView[]; nextCursor: string | null }> {
    const page = await this.deps.memberships.listPage(
      context.tenant.organizationId,
      toPageRequest(query),
    );
    const accounts =
      page.items.length === 0
        ? new Map()
        : await this.deps.users.getAccounts(page.items.map((membership) => membership.userId));
    return {
      items: page.items.map((membership) =>
        toMemberView(membership, accounts.get(membership.userId)),
      ),
      nextCursor: page.nextCursor,
    };
  }
}
