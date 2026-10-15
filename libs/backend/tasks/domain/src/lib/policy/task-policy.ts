import { canOnProject, type ProjectRole } from '@taskflow/backend/shared/kernel';
import { transitionTargets, type WorkflowView } from '../workflow/workflow';

export type TaskActions = Readonly<{
  update: boolean;
  assign: boolean;
  cancel: boolean;
  reopen: boolean;
  delete: boolean;
  /** Destinos permitidos pelo workflow (BR-004); BR-001/006 ficam para a API (422 com ids). */
  transitionTo: ReadonlyArray<string>;
}>;

/**
 * Ações do leitor sobre uma tarefa (dica de interface, spec 006). `ownsTaskTree` (D5): a tarefa
 * **e** todas as subtarefas foram criadas pelo leitor — a cascata não apaga trabalho alheio.
 */
export function taskActions(input: {
  readonly effectiveRole: ProjectRole | null;
  readonly archived: boolean;
  readonly task: Readonly<{ isCanceled: boolean; statusId: string }>;
  readonly ownsTaskTree: boolean;
  readonly workflow: WorkflowView;
}): TaskActions {
  const { effectiveRole: role, archived, task } = input;
  const can = (permission: 'task:update' | 'task:assign') =>
    canOnProject(role, permission, { ownsResource: false }) && !archived;
  const update = can('task:update') && !task.isCanceled;
  return {
    update,
    assign: can('task:assign') && !task.isCanceled,
    cancel: update,
    reopen: can('task:update') && task.isCanceled,
    delete: canOnProject(role, 'task:delete', { ownsResource: input.ownsTaskTree }) && !archived,
    transitionTo: update ? transitionTargets(input.workflow, task.statusId) : [],
  };
}
