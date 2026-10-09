import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import type { Clock } from '@taskflow/backend/shared/kernel';
import {
  canManageMembers,
  type InvitationRepository,
} from '@taskflow/backend/organizations/domain';
import type { UserDirectory } from '../ports/user-directory';
import { toInvitationView, type InvitationView } from '../shared/invitation-view';
import { InsufficientRoleError } from '../shared/organizations-errors';
import { toPageRequest, type PageQuery } from '../shared/pagination';

/** RF-07: owner e admin listam convites abertos (pendentes e expirados) com o convidante. */
export class ListInvitationsUseCase {
  constructor(
    private readonly deps: {
      readonly invitations: InvitationRepository;
      readonly users: UserDirectory;
      readonly clock: Clock;
    },
  ) {}

  async execute(
    context: TenantRequestContext,
    query: PageQuery,
  ): Promise<{ items: InvitationView[]; nextCursor: string | null }> {
    if (!canManageMembers(context.tenant.organizationRole)) throw new InsufficientRoleError();
    const page = await this.deps.invitations.listOpenPage(
      context.tenant.organizationId,
      toPageRequest(query),
    );
    const inviters =
      page.items.length === 0
        ? new Map()
        : await this.deps.users.getAccounts(page.items.map((item) => item.invitedByUserId));
    const now = this.deps.clock.now();
    return {
      items: page.items.map((item) =>
        toInvitationView(item, inviters.get(item.invitedByUserId), now),
      ),
      nextCursor: page.nextCursor,
    };
  }
}
