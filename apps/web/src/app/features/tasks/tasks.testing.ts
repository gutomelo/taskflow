import type { ProjectDto, TaskDto, TaskSummary, WorkflowDto } from '@taskflow/contracts';
import { acme, nextRequest } from '../../core/organizations/organizations.testing';
import { openProjectArea, PROJECT, projectDto } from '../projects/projects.testing';

export const TASKS = `/api/v1/organizations/${acme.id}/tasks`;
export const uuid = (suffix: string) => `0192a000-0000-7000-8000-${suffix.padStart(12, '0')}`;
export const STATUS = { todo: uuid('5101'), doing: uuid('5102'), done: uuid('5103') };
export const BIA = uuid('b1b1');

export const WORKFLOW: WorkflowDto = {
  version: 1,
  statuses: [
    { id: STATUS.todo, name: 'A fazer', category: 'todo', position: 0, inUse: false },
    { id: STATUS.doing, name: 'Em andamento', category: 'in_progress', position: 1, inUse: false },
    { id: STATUS.done, name: 'Concluído', category: 'done', position: 2, inUse: false },
  ],
  transitions: [
    { fromStatusId: STATUS.todo, toStatusId: STATUS.doing },
    { fromStatusId: STATUS.doing, toStatusId: STATUS.todo },
    { fromStatusId: STATUS.doing, toStatusId: STATUS.done },
    { fromStatusId: STATUS.done, toStatusId: STATUS.doing },
  ],
};

/** Projeto com as capacidades de tarefas que a API devolve para um gerente. */
export const tasksProject = (overrides: Partial<ProjectDto> = {}) =>
  projectDto({
    capabilities: [
      'project:read',
      'project:update',
      'project:archive',
      'project-member:manage',
      'task:create',
      'task:update',
      'task:assign',
      'task:delete',
    ],
    ...overrides,
  });

/** Tarefa resumida como a API devolve (número define id e chave). */
export function taskSummary(number: number, overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: uuid(`7${String(number).padStart(4, '0')}`),
    key: `WEB-${number}`,
    number,
    projectId: projectDto().id,
    title: `Tarefa ${number}`,
    status: { id: STATUS.todo, name: 'A fazer', category: 'todo' },
    priority: 'none',
    assignee: null,
    dueDate: null,
    parentTaskId: null,
    isRequired: false,
    completedAt: null,
    canceledAt: null,
    version: 1,
    ...overrides,
  };
}

/** Detalhe como a API devolve. */
export function taskDto(number: number, overrides: Partial<TaskDto> = {}): TaskDto {
  return {
    ...taskSummary(number),
    description: null,
    createdByUserId: uuid('a1a1'),
    createdAt: '2026-10-14T10:00:00.000Z',
    actions: {
      update: true,
      assign: true,
      cancel: true,
      reopen: false,
      delete: true,
      transitionTo: [STATUS.doing],
    },
    subtasks: [],
    blockedBy: [],
    blocking: [],
    blockingTruncated: false,
    ...overrides,
  };
}

export const listUrl = (query = '') => `${TASKS}?projectId=${projectDto().id}${query}`;

/** Abre a aba "Tarefas" e responde o fluxo de trabalho; a lista fica pendente para o teste. */
export async function openTasksTab(project = tasksProject()) {
  const env = await openProjectArea('/tasks', project);
  (await nextRequest(env.backend, `${PROJECT(project)}/workflow`)).flush(WORKFLOW);
  return env;
}
