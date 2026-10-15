import { TransitionNotAllowedError } from '../errors';

export type StatusCategory = 'todo' | 'in_progress' | 'done';

export type WorkflowStatusView = Readonly<{
  id: string;
  name: string;
  category: StatusCategory;
  position: number;
}>;

/** Workflow do projeto, lido de `projects` pela porta (os dados não são de `tasks`). */
export type WorkflowView = Readonly<{
  statuses: ReadonlyArray<WorkflowStatusView>;
  transitions: ReadonlyArray<Readonly<{ fromStatusId: string; toStatusId: string }>>;
}>;

export function findStatus(workflow: WorkflowView, statusId: string): WorkflowStatusView | null {
  return workflow.statuses.find((status) => status.id === statusId) ?? null;
}

/** Status inicial de uma tarefa nova: o primeiro de categoria `todo` pela posição. */
export function initialStatus(workflow: WorkflowView): WorkflowStatusView | null {
  return (
    [...workflow.statuses]
      .filter((status) => status.category === 'todo')
      .sort((a, b) => a.position - b.position)[0] ?? null
  );
}

/** Destinos permitidos a partir de um status (BR-004). */
export function transitionTargets(
  workflow: WorkflowView,
  fromStatusId: string,
): ReadonlyArray<string> {
  return workflow.transitions
    .filter((transition) => transition.fromStatusId === fromStatusId)
    .map((transition) => transition.toStatusId);
}

/** BR-004: só transições do workflow do projeto (ficar no mesmo status não é transição). */
export function assertTransitionAllowed(
  workflow: WorkflowView,
  fromStatusId: string,
  toStatusId: string,
): void {
  if (!transitionTargets(workflow, fromStatusId).includes(toStatusId))
    throw new TransitionNotAllowedError();
}
