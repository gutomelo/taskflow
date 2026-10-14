import type {
  AssignableUser,
  AssignableUserPage,
  TaskActions,
  TaskDto,
  TaskPage,
  TaskPriority,
  TaskSummary,
} from '@taskflow/contracts';

// Verificações de forma das respostas de tasks (spec 004). Como em `core/http`, os contratos
// entram no frontend só como tipos: Zod no bundle inicial custaria caro.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES: ReadonlySet<string> = new Set(['none', 'low', 'medium', 'high', 'urgent']);
const CATEGORIES: ReadonlySet<string> = new Set(['todo', 'in_progress', 'done']);
const PROJECT_ROLES: ReadonlySet<string> = new Set(['manager', 'member', 'viewer']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isNullable = (check: (value: unknown) => boolean) => (value: unknown) =>
  value === null || check(value);
const isDateTime = (value: unknown) => typeof value === 'string' && ISO_DATE_TIME.test(value);
const isNullableString = isNullable((value) => typeof value === 'string');
const isCursor = isNullableString;

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && PRIORITIES.has(value);
}

export function isTaskSummary(value: unknown): value is TaskSummary {
  if (!isRecord(value)) return false;
  const { status, assignee } = value;
  return (
    isUuid(value['id']) &&
    typeof value['key'] === 'string' &&
    Number.isInteger(value['number']) &&
    isUuid(value['projectId']) &&
    typeof value['title'] === 'string' &&
    isRecord(status) &&
    isUuid(status['id']) &&
    typeof status['name'] === 'string' &&
    typeof status['category'] === 'string' &&
    CATEGORIES.has(status['category']) &&
    isTaskPriority(value['priority']) &&
    (assignee === null ||
      (isRecord(assignee) && isUuid(assignee['userId']) && isNullableString(assignee['name']))) &&
    isNullable((date) => typeof date === 'string' && DATE.test(date))(value['dueDate']) &&
    isNullable(isUuid)(value['parentTaskId']) &&
    typeof value['isRequired'] === 'boolean' &&
    isNullable(isDateTime)(value['completedAt']) &&
    isNullable(isDateTime)(value['canceledAt']) &&
    Number.isInteger(value['version'])
  );
}

function isTaskActions(value: unknown): value is TaskActions {
  return (
    isRecord(value) &&
    ['update', 'assign', 'cancel', 'reopen', 'delete'].every(
      (key) => typeof value[key] === 'boolean',
    ) &&
    Array.isArray(value['transitionTo']) &&
    value['transitionTo'].every(isUuid)
  );
}

const isSummaryList = (value: unknown) => Array.isArray(value) && value.every(isTaskSummary);

export function isTask(value: unknown): value is TaskDto {
  if (!isRecord(value)) return false;
  return (
    isNullableString(value['description']) &&
    isUuid(value['createdByUserId']) &&
    isDateTime(value['createdAt']) &&
    isTaskActions(value['actions']) &&
    isSummaryList(value['subtasks']) &&
    isSummaryList(value['blockedBy']) &&
    isSummaryList(value['blocking']) &&
    typeof value['blockingTruncated'] === 'boolean' &&
    isTaskSummary(value)
  );
}

export function isTaskPage(value: unknown): value is TaskPage {
  return isRecord(value) && isSummaryList(value['items']) && isCursor(value['nextCursor']);
}

function isAssignableUser(value: unknown): value is AssignableUser {
  return (
    isRecord(value) &&
    isUuid(value['userId']) &&
    isNullableString(value['name']) &&
    isNullableString(value['email']) &&
    typeof value['effectiveRole'] === 'string' &&
    PROJECT_ROLES.has(value['effectiveRole'])
  );
}

export function isAssignableUserPage(value: unknown): value is AssignableUserPage {
  return (
    isRecord(value) &&
    Array.isArray(value['items']) &&
    value['items'].every(isAssignableUser) &&
    isCursor(value['nextCursor'])
  );
}
