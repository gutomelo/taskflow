import { toPageRequest, type TenantRequestContext } from '@taskflow/backend/shared/application';
import { canOnProject } from '@taskflow/backend/shared/kernel';
import type { Priority } from '@taskflow/backend/tasks/domain';
import type { AssignableUser } from '../ports/project-access';
import { findTaskForRead, type TaskLookup } from '../shared/task-access';
import {
  assigneesOf,
  loadTaskView,
  toTaskSummaryView,
  type TaskSummaryView,
  type TaskView,
} from '../shared/task-views';
import type { TasksDependencies } from '../shared/tasks-dependencies';
import { InsufficientRoleError, ProjectNotFoundError } from '../shared/tasks-errors';

export type ListTasksQuery = Readonly<{
  projectId: string;
  statusId?: string;
  assigneeUserId?: string;
  /** Separado do UUID (achado M6.1): "eu" ou "sem responsável". */
  assigned?: 'me' | 'none';
  priority?: Priority;
  /** Inclui as canceladas (fora por padrão, BR-029). */
  canceled?: boolean;
  /** Subtarefas de uma tarefa; ausente = só primeiro nível. */
  parentTaskId?: string;
  limit?: number;
  cursor?: string | null;
}>;

type Page<T> = Readonly<{ items: ReadonlyArray<T>; nextCursor: string | null }>;

/** RF-03: lista por cursor, número decrescente, em número fixo de consultas (RNF-04). */
export class ListTasksUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  async execute(
    context: TenantRequestContext,
    query: ListTasksQuery,
  ): Promise<Page<TaskSummaryView>> {
    const { organizationId, organizationRole } = context.tenant;
    const actorUserId = context.actor.userId;
    const project = await this.deps.projectAccess.resolveForRead(
      organizationId,
      { projectId: query.projectId },
      { userId: actorUserId, organizationRole },
    );
    if (!project) throw new ProjectNotFoundError();
    const mine = query.assigned === 'me' ? actorUserId : undefined;
    // "Eu" e outra pessoa ao mesmo tempo não casam com nada.
    if (mine && query.assigneeUserId !== undefined && query.assigneeUserId !== mine) {
      return { items: [], nextCursor: null };
    }
    const page = await this.deps.tasks.listPage(
      organizationId,
      project.projectId,
      {
        statusId: query.statusId,
        assigneeUserId: mine ?? query.assigneeUserId,
        unassigned: query.assigned === 'none',
        priority: query.priority,
        includeCanceled: query.canceled === true,
        parentTaskId: query.parentTaskId ?? null,
      },
      toPageRequest(query),
    );
    const names = await this.deps.users.getNames(assigneesOf(page.items));
    return {
      items: page.items.map((task) => toTaskSummaryView(task, project, names)),
      nextCursor: page.nextCursor,
    };
  }
}

/** RF-04: detalhe por id ou `CHAVE-N`; sem acesso ⇒ o mesmo 404 de "não existe". */
export class GetTaskUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  async execute(context: TenantRequestContext, lookup: TaskLookup): Promise<TaskView> {
    const { task, project } = await findTaskForRead(this.deps, context, lookup);
    return loadTaskView(
      this.deps,
      context.tenant.organizationId,
      project,
      task,
      context.actor.userId,
    );
  }
}

/** RF-06: candidatos a responsável (papel efetivo manager/member), para quem pode atribuir. */
export class ListAssignableUsersUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  async execute(
    context: TenantRequestContext,
    query: Readonly<{ projectId: string; limit?: number; cursor?: string | null }>,
  ): Promise<Page<AssignableUser>> {
    const { organizationId, organizationRole } = context.tenant;
    const project = await this.deps.projectAccess.resolveForRead(
      organizationId,
      { projectId: query.projectId },
      { userId: context.actor.userId, organizationRole },
    );
    if (!project) throw new ProjectNotFoundError();
    if (!canOnProject(project.effectiveRole, 'task:assign', { ownsResource: false })) {
      throw new InsufficientRoleError();
    }
    return this.deps.projectAccess.assignableUsers(
      organizationId,
      project.projectId,
      toPageRequest(query),
    );
  }
}
