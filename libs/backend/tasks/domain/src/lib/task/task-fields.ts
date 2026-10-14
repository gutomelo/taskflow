import { normalizeDisplayText } from '@taskflow/backend/shared/kernel';
import { InvalidDueDateError, InvalidTaskDescriptionError, InvalidTaskTitleError } from '../errors';

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_DESCRIPTION_MAX_LENGTH = 10_000;

/** Texto exibível, 1–200 caracteres. */
export class TaskTitle {
  private constructor(readonly value: string) {}

  static create(raw: string): TaskTitle {
    const normalized = normalizeDisplayText(raw, {
      minLength: 1,
      maxLength: TASK_TITLE_MAX_LENGTH,
    });
    if (normalized === null) throw new InvalidTaskTitleError();
    return new TaskTitle(normalized);
  }
}

/** Descrição em várias linhas (cada linha normalizada); vazia ⇒ `null`. */
export function parseTaskDescription(raw: string | null): string | null {
  if (raw === null) return null;
  const lines: string[] = [];
  for (const line of raw.split(/\r\n|\r|\n/u)) {
    const normalized = normalizeDisplayText(line, {
      minLength: 0,
      maxLength: TASK_DESCRIPTION_MAX_LENGTH,
    });
    if (normalized === null) throw new InvalidTaskDescriptionError();
    lines.push(normalized);
  }
  while (lines[0] === '') lines.shift();
  while (lines.at(-1) === '') lines.pop();
  const description = lines.join('\n');
  if ([...description].length > TASK_DESCRIPTION_MAX_LENGTH)
    throw new InvalidTaskDescriptionError();
  return description === '' ? null : description;
}

export const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export function isPriority(value: unknown): value is Priority {
  return typeof value === 'string' && PRIORITIES.some((priority) => priority === value);
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Prazo como data de calendário (`YYYY-MM-DD`), sem hora nem fuso; ano 2000–2999. */
export function parseDueDate(raw: string | null): string | null {
  if (raw === null) return null;
  const match = DATE.exec(raw);
  if (!match) throw new InvalidDueDateError();
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    year >= 2000 &&
    year <= 2999 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!valid) throw new InvalidDueDateError();
  return raw;
}

const TASK_KEY = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]{0,8})$/;

/** BR-028: `CHAVE-N` (ex.: `WEB-42`). `null` se malformada. */
export function parseTaskKey(raw: string): Readonly<{ projectKey: string; number: number }> | null {
  const match = TASK_KEY.exec(raw);
  if (!match?.[1] || !match[2]) return null;
  return { projectKey: match[1], number: Number(match[2]) };
}

export const formatTaskKey = (projectKey: string, number: number) => `${projectKey}-${number}`;
