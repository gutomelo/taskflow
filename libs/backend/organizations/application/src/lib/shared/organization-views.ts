import type { OrganizationRole } from '@taskflow/backend/shared/application';
import type { Organization } from '@taskflow/backend/organizations/domain';

/** Organização vista por um membro, com o papel dele. */
export type OrganizationView = Readonly<{
  id: string;
  name: string;
  slug: string;
  version: number;
  createdAt: Date;
  myRole: OrganizationRole;
}>;

/** Item de "minhas organizações" (RF-02). */
export type MyOrganizationView = Readonly<{
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
}>;

export function toOrganizationView(
  organization: Organization,
  myRole: OrganizationRole,
): OrganizationView {
  const { id, name, slug, version, createdAt } = organization.toSnapshot();
  return { id, name: name.value, slug: slug.value, version, createdAt, myRole };
}

export function toMyOrganizationView(
  organization: Organization,
  role: OrganizationRole,
): MyOrganizationView {
  const { id, name, slug } = organization.toSnapshot();
  return { id, name: name.value, slug: slug.value, role };
}
