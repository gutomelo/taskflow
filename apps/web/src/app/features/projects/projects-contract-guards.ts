import type {
  MemberCandidate,
  MemberCandidatePage,
  ProjectDto,
  ProjectMemberDto,
  ProjectMemberPage,
  ProjectPage,
  ProjectRole,
  ProjectSummary,
  WorkflowDto,
} from '@taskflow/contracts';
import { isOrganizationRole } from '../../core/organizations';

// Verificações de forma das respostas de projects (spec 003). Como em `core/http`, os contratos
// entram no frontend só como tipos: Zod no bundle inicial custaria caro.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const PROJECT_ROLES: ReadonlySet<string> = new Set(['manager', 'member', 'viewer']);
const CATEGORIES: ReadonlySet<string> = new Set(['todo', 'in_progress', 'done']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isDate = (value: unknown): value is string =>
  typeof value === 'string' && ISO_DATE_TIME.test(value);
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
/** Capacidades desconhecidas (API mais nova) são aceitas e nunca casam com `can()`. */
const isCapabilities = (value: unknown): boolean =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');
const isCursor = (value: unknown) => value === null || typeof value === 'string';

export function isProjectRole(value: unknown): value is ProjectRole {
  return typeof value === 'string' && PROJECT_ROLES.has(value);
}

export function isProject(value: unknown): value is ProjectDto {
  return (
    isRecord(value) &&
    isUuid(value['id']) &&
    typeof value['key'] === 'string' &&
    typeof value['name'] === 'string' &&
    isNullableString(value['description']) &&
    (value['archivedAt'] === null || isDate(value['archivedAt'])) &&
    Number.isInteger(value['version']) &&
    isDate(value['createdAt']) &&
    isProjectRole(value['myRole']) &&
    isCapabilities(value['capabilities'])
  );
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  return (
    isRecord(value) &&
    isUuid(value['id']) &&
    typeof value['key'] === 'string' &&
    typeof value['name'] === 'string' &&
    typeof value['archived'] === 'boolean' &&
    isProjectRole(value['myRole'])
  );
}

export function isProjectPage(value: unknown): value is ProjectPage {
  return (
    isRecord(value) &&
    Array.isArray(value['items']) &&
    value['items'].every(isProjectSummary) &&
    isCursor(value['nextCursor'])
  );
}

export function isWorkflow(value: unknown): value is WorkflowDto {
  return (
    isRecord(value) &&
    Array.isArray(value['statuses']) &&
    value['statuses'].every(
      (status) =>
        isRecord(status) &&
        isUuid(status['id']) &&
        typeof status['name'] === 'string' &&
        typeof status['category'] === 'string' &&
        CATEGORIES.has(status['category']) &&
        Number.isInteger(status['position']),
    ) &&
    Array.isArray(value['transitions']) &&
    value['transitions'].every(
      (transition) =>
        isRecord(transition) &&
        isUuid(transition['fromStatusId']) &&
        isUuid(transition['toStatusId']),
    )
  );
}

export function isProjectMember(value: unknown): value is ProjectMemberDto {
  if (!isRecord(value) || !isRecord(value['actions'])) return false;
  const actions = value['actions'];
  return (
    isUuid(value['userId']) &&
    isNullableString(value['name']) &&
    isNullableString(value['email']) &&
    isProjectRole(value['role']) &&
    isProjectRole(value['effectiveRole']) &&
    Number.isInteger(value['version']) &&
    isDate(value['joinedAt']) &&
    Array.isArray(actions['changeRoleTo']) &&
    actions['changeRoleTo'].every(isProjectRole) &&
    typeof actions['remove'] === 'boolean' &&
    typeof actions['leave'] === 'boolean'
  );
}

export function isProjectMemberPage(value: unknown): value is ProjectMemberPage {
  return (
    isRecord(value) &&
    Array.isArray(value['items']) &&
    value['items'].every(isProjectMember) &&
    isCursor(value['nextCursor'])
  );
}

function isMemberCandidate(value: unknown): value is MemberCandidate {
  return (
    isRecord(value) &&
    isUuid(value['userId']) &&
    isNullableString(value['name']) &&
    isNullableString(value['email']) &&
    isOrganizationRole(value['organizationRole']) &&
    Array.isArray(value['allowedRoles']) &&
    value['allowedRoles'].every(isProjectRole)
  );
}

export function isMemberCandidatePage(value: unknown): value is MemberCandidatePage {
  return (
    isRecord(value) &&
    Array.isArray(value['items']) &&
    value['items'].every(isMemberCandidate) &&
    isCursor(value['nextCursor'])
  );
}
