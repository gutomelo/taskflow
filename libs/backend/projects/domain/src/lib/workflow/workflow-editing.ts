import { normalizeDisplayText } from '@taskflow/backend/shared/kernel';
import {
  InvalidStatusNameError,
  InvalidStatusOrderError,
  InvalidStatusTargetError,
  InvalidTransitionError,
  StatusInUseError,
  StatusLimitReachedError,
  StatusNameTakenError,
  StatusNotFoundError,
  WorkflowNeedsTodoStatusError,
} from '../errors';
import type { StatusCategory, Workflow, WorkflowStatus, WorkflowTransition } from './workflow';

// BR-030 (spec 005): edições do workflow como funções puras. Quem chama relê o workflow e a
// contagem de tarefas por status sob o lock do projeto e grava o resultado inteiro. Ordem das
// verificações: referências (404 `STATUS_NOT_FOUND`) antes das regras (achado A1 da segurança).

export const MAX_WORKFLOW_STATUSES = 20;
export const STATUS_NAME_MAX_LENGTH = 40;

/** Tarefas por status (todas: canceladas e subtarefas incluídas). Ausente = 0. */
export type StatusUsage = ReadonlyMap<string, number>;

export function parseStatusName(raw: string): string {
  const name = normalizeDisplayText(raw, { minLength: 1, maxLength: STATUS_NAME_MAX_LENGTH });
  if (name === null) throw new InvalidStatusNameError();
  return name;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function statusOf(workflow: Workflow, statusId: string): WorkflowStatus {
  const status = workflow.statuses.find((candidate) => candidate.id === statusId);
  if (!status) throw new StatusNotFoundError();
  return status;
}

function assertNameFree(workflow: Workflow, name: string, exceptId?: string): void {
  if (workflow.statuses.some((status) => status.id !== exceptId && sameName(status.name, name))) {
    throw new StatusNameTakenError();
  }
}

function assertHasTodo(statuses: ReadonlyArray<WorkflowStatus>): void {
  if (!statuses.some((status) => status.category === 'todo')) {
    throw new WorkflowNeedsTodoStatusError();
  }
}

/** Posições `0..n−1` na ordem dada (a posição não é única no banco; reescrita sob lock). */
function renumber(statuses: ReadonlyArray<WorkflowStatus>): WorkflowStatus[] {
  return statuses.map((status, position) => ({ ...status, position }));
}

const ordered = (workflow: Workflow) =>
  [...workflow.statuses].sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1));

/** RF-05: status novo no fim, sem transições. */
export function addStatus(
  workflow: Workflow,
  input: Readonly<{ id: string; name: string; category: StatusCategory }>,
): Workflow {
  const name = parseStatusName(input.name);
  if (workflow.statuses.length >= MAX_WORKFLOW_STATUSES) throw new StatusLimitReachedError();
  assertNameFree(workflow, name);
  const statuses = renumber([
    ...ordered(workflow),
    { id: input.id, name, category: input.category, position: 0 },
  ]);
  return { statuses, transitions: workflow.transitions };
}

/** RF-06: renomear. */
export function renameStatus(workflow: Workflow, statusId: string, rawName: string): Workflow {
  statusOf(workflow, statusId);
  const name = parseStatusName(rawName);
  assertNameFree(workflow, name, statusId);
  return {
    statuses: workflow.statuses.map((status) =>
      status.id === statusId ? { ...status, name } : status,
    ),
    transitions: workflow.transitions,
  };
}

/** RF-07: categoria só muda em status sem tarefas; sempre sobra um `todo`. */
export function changeCategory(
  workflow: Workflow,
  statusId: string,
  category: StatusCategory,
  usage: StatusUsage,
): Workflow {
  const status = statusOf(workflow, statusId);
  if (status.category === category) return workflow;
  if ((usage.get(statusId) ?? 0) > 0) throw new StatusInUseError();
  const statuses = workflow.statuses.map((candidate) =>
    candidate.id === statusId ? { ...candidate, category } : candidate,
  );
  assertHasTodo(statuses);
  return { statuses, transitions: workflow.transitions };
}

/** RF-06: nova ordem com exatamente os status do workflow. */
export function reorderStatuses(workflow: Workflow, statusIds: ReadonlyArray<string>): Workflow {
  const statuses = statusIds.map((statusId) => statusOf(workflow, statusId));
  if (
    new Set(statusIds).size !== statusIds.length ||
    statusIds.length !== workflow.statuses.length
  ) {
    throw new InvalidStatusOrderError();
  }
  return { statuses: renumber(statuses), transitions: workflow.transitions };
}

/**
 * RF-08: remove o status. Com tarefas, exige destino distinto e da mesma categoria (D2: a
 * conclusão das tarefas nunca muda por configuração); sem tarefas, o destino é opcional. As
 * transições do status removido caem junto.
 */
export function removeStatus(
  workflow: Workflow,
  statusId: string,
  targetStatusId: string | null,
  usage: StatusUsage,
): Readonly<{ workflow: Workflow; targetStatusId: string | null }> {
  const status = statusOf(workflow, statusId);
  const target = targetStatusId === null ? null : statusOf(workflow, targetStatusId);
  const remaining = workflow.statuses.filter((candidate) => candidate.id !== statusId);
  assertHasTodo(remaining);
  const inUse = (usage.get(statusId) ?? 0) > 0;
  if (target && (target.id === status.id || target.category !== status.category)) {
    throw new InvalidStatusTargetError();
  }
  if (inUse && !target) throw new InvalidStatusTargetError();
  return {
    workflow: {
      statuses: renumber(ordered({ statuses: remaining, transitions: [] })),
      transitions: workflow.transitions.filter(
        (transition) => transition.fromStatusId !== statusId && transition.toStatusId !== statusId,
      ),
    },
    targetStatusId: inUse ? (target?.id ?? null) : null,
  };
}

/** RF-09: substitui o conjunto de transições (pares distintos, sem repetição). */
export function replaceTransitions(
  workflow: Workflow,
  transitions: ReadonlyArray<WorkflowTransition>,
): Workflow {
  for (const transition of transitions) {
    statusOf(workflow, transition.fromStatusId);
    statusOf(workflow, transition.toStatusId);
  }
  const keys = transitions.map(
    (transition) => `${transition.fromStatusId}>${transition.toStatusId}`,
  );
  if (
    transitions.some((transition) => transition.fromStatusId === transition.toStatusId) ||
    new Set(keys).size !== keys.length
  ) {
    throw new InvalidTransitionError();
  }
  return {
    statuses: workflow.statuses,
    transitions: transitions.map(({ fromStatusId, toStatusId }) => ({ fromStatusId, toStatusId })),
  };
}
