import type { OrganizationAccess } from '@taskflow/backend/projects/application';
import type {
  GetMemberRolesUseCase,
  ListMembersExcludingUseCase,
  LockMembersForShareUseCase,
  LockOrganizationForShareUseCase,
} from '@taskflow/backend/organizations/application';

/**
 * Porta `OrganizationAccess` de `projects` ligada às consultas de `organizations` (spec 003).
 * `lockForShare` roda na transação de `projects`: os dois módulos recebem a **mesma** instância
 * de `PrismaTransactionRunner`; fora de transação, o repositório lança (falha fechada).
 */
export function createOrganizationAccess(organizations: {
  readonly access: Readonly<{
    lockForShare: Pick<LockOrganizationForShareUseCase, 'execute'>;
    lockMembersForShare: Pick<LockMembersForShareUseCase, 'execute'>;
    rolesOf: Pick<GetMemberRolesUseCase, 'execute'>;
    membersExcluding: Pick<ListMembersExcludingUseCase, 'execute'>;
  }>;
}): OrganizationAccess {
  const { access } = organizations;
  return {
    lockForShare: (organizationId, userIds) => access.lockForShare.execute(organizationId, userIds),
    lockMembersForShare: (organizationId, userIds) =>
      access.lockMembersForShare.execute(organizationId, userIds),
    rolesOf: (organizationId, userIds) => access.rolesOf.execute(organizationId, userIds),
    listMembersPage: ({ organizationId, excludeUserIds, roles, limit, cursor }) =>
      access.membersExcluding.execute(organizationId, { excludeUserIds, roles }, { limit, cursor }),
  };
}
