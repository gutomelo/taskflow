import {
  InvalidDueDateError,
  InvalidTaskDescriptionError,
  InvalidTaskTitleError,
  RequiredWithoutParentError,
  TaskCanceledError,
} from '../errors';
import type { WorkflowStatusView } from '../workflow/workflow';
import {
  formatTaskKey,
  isPriority,
  parseDueDate,
  parseTaskDescription,
  parseTaskKey,
  TaskTitle,
} from './task-fields';
import { Task } from './task';

const NOW = new Date('2026-10-14T10:00:00.000Z');
const LATER = new Date('2026-10-14T11:00:00.000Z');
const TODO: WorkflowStatusView = { id: 's-todo', name: 'A fazer', category: 'todo', position: 0 };
const DOING: WorkflowStatusView = {
  id: 's-doing',
  name: 'Em andamento',
  category: 'in_progress',
  position: 1,
};
const DONE: WorkflowStatusView = { id: 's-done', name: 'Concluído', category: 'done', position: 2 };

function task(overrides: Partial<{ parentTaskId: string | null; isRequired: boolean }> = {}) {
  return Task.create({
    id: 't-1',
    organizationId: 'org',
    projectId: 'p',
    number: 1,
    title: TaskTitle.create('Escrever'),
    description: null,
    status: TODO,
    priority: 'none',
    assigneeUserId: null,
    dueDate: null,
    parentTaskId: overrides.parentTaskId ?? null,
    isRequired: overrides.isRequired ?? false,
    createdByUserId: 'u-1',
    now: NOW,
  });
}

describe('task fields', () => {
  it('normalizes the title and enforces 1–200 characters', () => {
    expect(TaskTitle.create('  Revisar   texto ').value).toBe('Revisar texto');
    expect(() => TaskTitle.create('   ')).toThrow(InvalidTaskTitleError);
    expect(() => TaskTitle.create('x'.repeat(201))).toThrow(InvalidTaskTitleError);
  });

  it('keeps description lines and rejects invisible formatting', () => {
    expect(parseTaskDescription('\n a  b \n\n c\n')).toBe('a b\n\nc');
    expect(parseTaskDescription(' \n ')).toBeNull();
    expect(() => parseTaskDescription('x​')).toThrow(InvalidTaskDescriptionError);
  });

  it.each(['2026-02-28', '2028-02-29'])('accepts the calendar date %s', (date) => {
    expect(parseDueDate(date)).toBe(date);
  });

  it.each(['2026-02-29', '2026-13-01', '26-01-01', '2026-1-1', '1999-12-31', '2026-01-01T00:00'])(
    'rejects %j as due date',
    (date) => {
      expect(() => parseDueDate(date)).toThrow(InvalidDueDateError);
    },
  );

  it('BR-028: parses and formats CHAVE-N', () => {
    expect(parseTaskKey('WEB-42')).toEqual({ projectKey: 'WEB', number: 42 });
    expect(formatTaskKey('WEB', 42)).toBe('WEB-42');
    for (const bad of ['WEB-0', 'WEB-01', 'web-1', 'W-1', 'WEB42', 'WEB-1234567890']) {
      expect(parseTaskKey(bad)).toBeNull();
    }
  });

  it('knows the five priorities', () => {
    expect(['none', 'low', 'medium', 'high', 'urgent'].every(isPriority)).toBe(true);
    expect(isPriority('critical')).toBe(false);
  });
});

describe('Task', () => {
  it('only subtasks can be required', () => {
    expect(() => task({ isRequired: true })).toThrow(RequiredWithoutParentError);
    const subtask = task({ parentTaskId: 't-0', isRequired: true });
    expect(subtask.isRequired).toBe(true);
    expect(() => task().setRequired(true, NOW)).toThrow(RequiredWithoutParentError);
  });

  it('completion follows the done category, keeping the first completion while staying done', () => {
    const subject = task();
    subject.moveTo(DOING, 'u-2', LATER);
    expect(subject.isCompleted).toBe(false);
    subject.moveTo(DONE, 'u-2', LATER);
    expect(subject.toSnapshot()).toMatchObject({ completedAt: LATER, completedByUserId: 'u-2' });
    subject.moveTo(DOING, 'u-3', NOW);
    expect(subject.toSnapshot()).toMatchObject({ completedAt: null, completedByUserId: null });
  });

  it('BR-029: a canceled task is read-only until reopened, and is not pending', () => {
    const subject = task();
    expect(subject.cancel('u-2', LATER)).toBe(true);
    expect(subject.cancel('u-2', LATER)).toBe(false);
    expect(subject.isPending).toBe(false);
    expect(() => subject.edit({ priority: 'high' }, LATER)).toThrow(TaskCanceledError);
    expect(() => subject.assign('u-3', LATER)).toThrow(TaskCanceledError);
    expect(() => subject.moveTo(DOING, 'u-2', LATER)).toThrow(TaskCanceledError);
    expect(subject.reopen(LATER)).toBe(true);
    expect(subject.reopen(LATER)).toBe(false);
    subject.edit({ priority: 'high' }, LATER);
    expect(subject.toSnapshot().priority).toBe('high');
  });

  it('edits only the given fields', () => {
    const subject = task();
    subject.edit({ dueDate: '2026-12-01' }, LATER);
    subject.edit({ title: TaskTitle.create('Novo') }, LATER);

    expect(subject.toSnapshot()).toMatchObject({
      dueDate: '2026-12-01',
      priority: 'none',
      updatedAt: LATER,
    });
    expect(subject.toSnapshot().title.value).toBe('Novo');
  });
});
