import type { OrganizationRole } from '@taskflow/backend/shared/application';
import {
  organizationPermissions,
  type OrganizationPermission,
} from '@taskflow/backend/shared/kernel';
import type { Organization } from '@taskflow/backend/organizations/domain';

/**
 * Organização vista por um membro, com o papel dele e as **capacidades** (spec 006): permissões
 * efetivas para a interface decidir o que mostrar. Dica apenas — toda mutação é decidida no caso
 * de uso. Calculadas sem consulta extra (papel resolvido e organização já carregada).
 */
export type OrganizationView = Readonly<{
  id: string;
  name: string;
  slug: string;
  membersCanCreateProjects: boolean;
  version: number;
  createdAt: Date;
  myRole: OrganizationRole;
  capabilities: ReadonlyArray<OrganizationPermission>;
}>;

/** Item de "minhas organizações" (RF-02), com as capacidades do usuário nela. */
export type MyOrganizationView = Readonly<{
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  capabilities: ReadonlyArray<OrganizationPermission>;
}>;

export function toOrganizationView(
  organization: Organization,
  myRole: OrganizationRole,
): OrganizationView {
  const { id, name, slug, membersCanCreateProjects, version, createdAt } =
    organization.toSnapshot();
  return {
    id,
    name: name.value,
    slug: slug.value,
    membersCanCreateProjects,
    version,
    createdAt,
    myRole,
    capabilities: organizationPermissions(myRole, organization.settings),
  };
}

export function toMyOrganizationView(
  organization: Organization,
  role: OrganizationRole,
): MyOrganizationView {
  const { id, name, slug } = organization.toSnapshot();
  return {
    id,
    name: name.value,
    slug: slug.value,
    role,
    capabilities: organizationPermissions(role, organization.settings),
  };
}
