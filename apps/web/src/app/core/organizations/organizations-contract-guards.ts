import type {
  InvitableRole,
  InvitationDto,
  InvitationPage,
  InvitationPreview,
  Member,
  MemberPage,
  MyOrganization,
  MyOrganizationList,
  OrganizationDto,
  OrganizationRole,
} from '@taskflow/contracts';

// Verificações de forma das respostas de organizations (spec 002). Como em `core/http`, os
// contratos entram no frontend só como tipos: Zod no bundle inicial custaria caro.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ROLES: ReadonlySet<string> = new Set(['owner', 'admin', 'member', 'viewer']);
const INVITABLE_ROLES: ReadonlySet<string> = new Set(['admin', 'member', 'viewer']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && ISO_DATE_TIME.test(value);
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

export function isOrganizationRole(value: unknown): value is OrganizationRole {
  return typeof value === 'string' && ROLES.has(value);
}

function isInvitableRole(value: unknown): value is InvitableRole {
  return typeof value === 'string' && INVITABLE_ROLES.has(value);
}

export function isMyOrganization(value: unknown): value is MyOrganization {
  return (
    isRecord(value) &&
    isUuid(value['id']) &&
    typeof value['name'] === 'string' &&
    typeof value['slug'] === 'string' &&
    isOrganizationRole(value['role'])
  );
}

export function isMyOrganizationList(value: unknown): value is MyOrganizationList {
  return isRecord(value) && Array.isArray(value['items']) && value['items'].every(isMyOrganization);
}

export function isOrganization(value: unknown): value is OrganizationDto {
  return (
    isRecord(value) &&
    isUuid(value['id']) &&
    typeof value['name'] === 'string' &&
    typeof value['slug'] === 'string' &&
    Number.isInteger(value['version']) &&
    isDate(value['createdAt']) &&
    isOrganizationRole(value['myRole'])
  );
}

export function isMember(value: unknown): value is Member {
  return (
    isRecord(value) &&
    isUuid(value['userId']) &&
    isNullableString(value['name']) &&
    isNullableString(value['email']) &&
    isOrganizationRole(value['role']) &&
    Number.isInteger(value['version']) &&
    isDate(value['joinedAt'])
  );
}

export function isMemberPage(value: unknown): value is MemberPage {
  return (
    isRecord(value) &&
    Array.isArray(value['items']) &&
    value['items'].every(isMember) &&
    isNullableString(value['nextCursor'])
  );
}

export function isInvitation(value: unknown): value is InvitationDto {
  const invitedBy = isRecord(value) ? value['invitedBy'] : undefined;
  return (
    isRecord(value) &&
    isRecord(invitedBy) &&
    isUuid(value['id']) &&
    typeof value['email'] === 'string' &&
    isInvitableRole(value['role']) &&
    (value['status'] === 'pending' || value['status'] === 'expired') &&
    isUuid(invitedBy['userId']) &&
    isNullableString(invitedBy['name']) &&
    isDate(value['expiresAt']) &&
    isDate(value['createdAt'])
  );
}

export function isInvitationPage(value: unknown): value is InvitationPage {
  return (
    isRecord(value) &&
    Array.isArray(value['items']) &&
    value['items'].every(isInvitation) &&
    isNullableString(value['nextCursor'])
  );
}

export function isInvitationPreview(value: unknown): value is InvitationPreview {
  return (
    isRecord(value) &&
    typeof value['organizationName'] === 'string' &&
    isInvitableRole(value['role']) &&
    isNullableString(value['invitedByName']) &&
    typeof value['maskedEmail'] === 'string' &&
    typeof value['isForCurrentUser'] === 'boolean' &&
    isDate(value['expiresAt'])
  );
}
