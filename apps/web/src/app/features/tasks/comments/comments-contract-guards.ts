import type { CommentDto, CommentPage, MentionCandidatePage } from '@taskflow/contracts';

// Verificações de forma das respostas de comentários (spec 010). Como em `core/http`, os contratos
// entram no frontend só como tipos: Zod no bundle inicial custaria caro.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const isDateTime = (value: unknown) => typeof value === 'string' && ISO_DATE_TIME.test(value);
const isNullable = (check: (value: unknown) => boolean) => (value: unknown) =>
  value === null || check(value);
const isNullableString = isNullable((value) => typeof value === 'string');

const isPerson = (value: unknown) =>
  isRecord(value) && isUuid(value['userId']) && isNullableString(value['name']);

export function isComment(value: unknown): value is CommentDto {
  if (!isRecord(value)) return false;
  const { actions, mentions } = value;
  return (
    isUuid(value['id']) &&
    isUuid(value['taskId']) &&
    isPerson(value['author']) &&
    isNullableString(value['body']) &&
    Array.isArray(mentions) &&
    mentions.every(isPerson) &&
    isDateTime(value['createdAt']) &&
    isNullable(isDateTime)(value['editedAt']) &&
    isNullable(isDateTime)(value['deletedAt']) &&
    Number.isInteger(value['version']) &&
    isRecord(actions) &&
    typeof actions['edit'] === 'boolean' &&
    typeof actions['delete'] === 'boolean'
  );
}

export function isCommentPage(value: unknown): value is CommentPage {
  if (!isRecord(value)) return false;
  const { items, actions, count } = value;
  return (
    Array.isArray(items) &&
    items.every(isComment) &&
    isNullableString(value['nextCursor']) &&
    (count === undefined || Number.isInteger(count)) &&
    isRecord(actions) &&
    typeof actions['comment'] === 'boolean'
  );
}

export function isMentionCandidatePage(value: unknown): value is MentionCandidatePage {
  if (!isRecord(value)) return false;
  const { items } = value;
  return (
    Array.isArray(items) &&
    items.every(
      (item) =>
        isRecord(item) &&
        isUuid(item['userId']) &&
        typeof item['name'] === 'string' &&
        typeof item['email'] === 'string',
    ) &&
    isNullableString(value['nextCursor'])
  );
}
