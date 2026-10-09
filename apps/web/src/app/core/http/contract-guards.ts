import type {
  CurrentUser,
  FieldViolation,
  ProblemDetails,
  SessionList,
  SessionSummary,
} from '@taskflow/contracts';

// Verificações de forma das respostas da API. Os contratos entram no frontend só como tipos:
// os schemas Zod de `@taskflow/contracts` custariam ~500 kB no bundle inicial (medido na T25).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isCurrentUser(value: unknown): value is CurrentUser {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    UUID.test(value['id']) &&
    typeof value['name'] === 'string' &&
    typeof value['email'] === 'string' &&
    typeof value['emailVerified'] === 'boolean'
  );
}

function isFieldViolation(value: unknown): value is FieldViolation {
  return (
    isRecord(value) && typeof value['field'] === 'string' && typeof value['message'] === 'string'
  );
}

export function isProblemDetails(value: unknown): value is ProblemDetails {
  return (
    isRecord(value) &&
    typeof value['code'] === 'string' &&
    typeof value['status'] === 'number' &&
    typeof value['title'] === 'string' &&
    (value['violations'] === undefined ||
      (Array.isArray(value['violations']) && value['violations'].every(isFieldViolation)))
  );
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isSessionSummary(value: unknown): value is SessionSummary {
  if (!isRecord(value) || !isRecord(value['device'])) return false;
  const { id, createdAt, lastUsedAt, device, isCurrent } = value;
  return (
    typeof id === 'string' &&
    UUID.test(id) &&
    typeof createdAt === 'string' &&
    ISO_DATE_TIME.test(createdAt) &&
    typeof lastUsedAt === 'string' &&
    ISO_DATE_TIME.test(lastUsedAt) &&
    isNullableString(device['browser']) &&
    isNullableString(device['os']) &&
    typeof isCurrent === 'boolean'
  );
}

export function isSessionList(value: unknown): value is SessionList {
  return isRecord(value) && Array.isArray(value['items']) && value['items'].every(isSessionSummary);
}

/** Resposta fora do contrato: tratada como falha (nunca confiar em forma não verificada). */
export class ContractViolationError extends Error {
  constructor(readonly endpoint: string) {
    super(`Response from ${endpoint} does not match the API contract`);
    this.name = 'ContractViolationError';
  }
}
