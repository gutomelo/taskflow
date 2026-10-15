import type { DomainError } from '@taskflow/backend/shared/kernel';
import type { DomainErrorMapping } from '@taskflow/backend/shared/http';
import {
  TaskBlockedByDependenciesError,
  TaskHasPendingRequiredSubtasksError,
} from '@taskflow/backend/tasks/domain';

/** Extensão `taskIds` (BR-001/BR-006): só ids de tarefas do mesmo projeto, já visíveis ao ator. */
const blockingTaskIds = (error: DomainError): ReadonlyArray<string> =>
  error instanceof TaskHasPendingRequiredSubtasksError ||
  error instanceof TaskBlockedByDependenciesError
    ? error.taskIds
    : [];

/**
 * Tradução dos códigos de `tasks` para HTTP (design da spec 004). Títulos em pt-BR seguros para
 * exibição. `PROJECT_NOT_FOUND`, `PROJECT_ARCHIVED`, `ORGANIZATION_NOT_FOUND`, `INSUFFICIENT_ROLE`
 * e `VERSION_CONFLICT` reutilizam os códigos de `projects` com o mesmo status e título (teste de
 * colisão em `apps/api`).
 */
export const tasksErrorMappings: Readonly<Record<string, DomainErrorMapping>> = {
  INVALID_TASK_TITLE: { status: 400, title: 'Título inválido: use de 1 a 200 caracteres' },
  INVALID_TASK_DESCRIPTION: { status: 400, title: 'Descrição inválida' },
  INVALID_DUE_DATE: { status: 400, title: 'Prazo inválido: use uma data AAAA-MM-DD' },
  TASK_NOT_FOUND: { status: 404, title: 'Tarefa não encontrada' },
  STATUS_NOT_FOUND: { status: 404, title: 'Status não encontrado no workflow do projeto' },
  DEPENDENCY_NOT_FOUND: { status: 404, title: 'Dependência não encontrada' },
  TASK_CANCELED: { status: 409, title: 'A tarefa está cancelada: reabra-a para alterar' },
  TRANSITION_NOT_ALLOWED: {
    status: 422,
    title: 'O workflow do projeto não permite esta mudança de status',
  },
  TASK_HAS_PENDING_REQUIRED_SUBTASKS: {
    status: 422,
    title: 'Há subtarefas obrigatórias pendentes',
    taskIds: blockingTaskIds,
  },
  TASK_BLOCKED_BY_DEPENDENCIES: {
    status: 422,
    title: 'A tarefa está bloqueada por tarefas pendentes',
    taskIds: blockingTaskIds,
  },
  PARENT_TASK_COMPLETED: {
    status: 422,
    title: 'A tarefa pai está concluída: não pode ganhar subtarefa obrigatória pendente',
  },
  SUBTASK_DEPTH: { status: 422, title: 'Subtarefas não podem ter subtarefas' },
  REQUIRED_WITHOUT_PARENT: { status: 422, title: 'Só subtarefas podem ser obrigatórias' },
  DEPENDENCY_CYCLE: { status: 422, title: 'A dependência criaria um ciclo' },
  DEPENDENCY_LIMIT_REACHED: { status: 422, title: 'Limite de dependências atingido' },
  ASSIGNEE_NOT_PROJECT_MEMBER: {
    status: 422,
    title: 'O responsável precisa poder contribuir no projeto',
  },
  TASK_LIMIT_REACHED: { status: 422, title: 'Limite de tarefas atingido' },
  INVALID_POSITION: { status: 422, title: 'Posição inválida no quadro' },
  INVALID_CURSOR: { status: 400, title: 'Cursor inválido' },
  TASK_NOT_A_CARD: { status: 422, title: 'Subtarefas não aparecem como cards no quadro' },
  SUBTASK_LIMIT_REACHED: { status: 422, title: 'Limite de subtarefas da tarefa atingido' },
  PROJECT_NOT_FOUND: { status: 404, title: 'Projeto não encontrado' },
  PROJECT_ARCHIVED: { status: 409, title: 'O projeto está arquivado' },
  ORGANIZATION_NOT_FOUND: { status: 404, title: 'Organização não encontrada' },
  INSUFFICIENT_ROLE: { status: 403, title: 'Seu papel não permite esta ação' },
  VERSION_CONFLICT: {
    status: 409,
    title: 'Os dados foram alterados por outra operação. Tente novamente.',
  },
};
