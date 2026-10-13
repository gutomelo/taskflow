import {
  EmailAddress,
  isOrganizationRole,
  type OrganizationRole,
} from '@taskflow/backend/shared/kernel';
import {
  assertInvitableRole,
  Invitation,
  Membership,
  Organization,
  OrganizationName,
  OrganizationSlug,
} from '@taskflow/backend/organizations/domain';
import type {
  InvitationRow,
  MembershipRow,
  OrganizationRow,
} from '@taskflow/backend/shared/infrastructure';

/** Papel lido do banco: valor fora do enum é dado corrompido — falha alto, nunca concede. */
function roleFrom(value: string): OrganizationRole {
  if (!isOrganizationRole(value))
    throw new Error(`Unknown organization role in database: ${value}`);
  return value;
}

export function toOrganization(row: OrganizationRow): Organization {
  return Organization.restore({
    id: row.id,
    name: OrganizationName.create(row.name),
    slug: OrganizationSlug.create(row.slug),
    membersCanCreateProjects: row.membersCanCreateProjects,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toMembership(row: MembershipRow): Membership {
  return Membership.restore({
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    role: roleFrom(row.role),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

export function toInvitation(row: InvitationRow): Invitation {
  return Invitation.restore({
    id: row.id,
    organizationId: row.organizationId,
    email: EmailAddress.create(row.email),
    role: assertInvitableRole(roleFrom(row.role)),
    invitedByUserId: row.invitedByUserId,
    deliveryEventId: row.deliveryEventId,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    acceptedByUserId: row.acceptedByUserId,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}
