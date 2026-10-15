import type { MembershipRoleChanges } from '@taskflow/backend/organizations/application';
import type { ApplyOrganizationRoleChangeUseCase } from '@taskflow/backend/projects/application';

/**
 * Porta `MembershipRoleChanges` de `organizations` ligada à reação de `projects` (BR-027, spec 003).
 * Roda na transação de `ChangeMemberRole`: os dois módulos recebem a **mesma** instância de
 * `PrismaTransactionRunner` (o `AsyncLocalStorage` é por instância).
 */
export function createMembershipRoleChanges(projects: {
  readonly applyOrganizationRoleChange: Pick<ApplyOrganizationRoleChangeUseCase, 'execute'>;
}): MembershipRoleChanges {
  return { roleChanged: (change) => projects.applyOrganizationRoleChange.execute(change) };
}
