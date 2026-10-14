import { Router, type Request } from 'express';
import {
  HttpError,
  noStore,
  parseBody,
  tenantRequestContextFrom,
} from '@taskflow/backend/shared/http';
import type {
  AddDependencyUseCase,
  AssignableUser as AssignableUserView,
  AssignTaskUseCase,
  CancelTaskUseCase,
  CreateTaskUseCase,
  DeleteTaskUseCase,
  GetTaskUseCase,
  ListAssignableUsersUseCase,
  ListTasksUseCase,
  RemoveDependencyUseCase,
  ReopenTaskUseCase,
  TaskSummaryView,
  TaskView,
  TransitionTaskUseCase,
  UpdateTaskUseCase,
} from '@taskflow/backend/tasks/application';
import {
  addDependencyRequestSchema,
  assignableUsersQuerySchema,
  assignTaskRequestSchema,
  createTaskRequestSchema,
  deleteTaskQuerySchema,
  taskDependencyParamSchema,
  taskIdParamSchema,
  taskKeyParamSchema,
  taskListQuerySchema,
  taskVersionRequestSchema,
  transitionTaskRequestSchema,
  updateTaskRequestSchema,
  type AssignableUser,
  type AssignableUserPage,
  type TaskDto,
  type TaskPage,
  type TaskSummary,
} from '@taskflow/contracts';
import type { z } from 'zod';

type Executes<T extends { execute: (...args: never[]) => unknown }> = Pick<T, 'execute'>;

export interface TasksHttpDependencies {
  readonly useCases: Readonly<{
    createTask: Executes<CreateTaskUseCase>;
    listTasks: Executes<ListTasksUseCase>;
    getTask: Executes<GetTaskUseCase>;
    listAssignableUsers: Executes<ListAssignableUsersUseCase>;
    updateTask: Executes<UpdateTaskUseCase>;
    assignTask: Executes<AssignTaskUseCase>;
    transitionTask: Executes<TransitionTaskUseCase>;
    cancelTask: Executes<CancelTaskUseCase>;
    reopenTask: Executes<ReopenTaskUseCase>;
    deleteTask: Executes<DeleteTaskUseCase>;
    addDependency: Executes<AddDependencyUseCase>;
    removeDependency: Executes<RemoveDependencyUseCase>;
  }>;
}

const taskNotFound = () => new HttpError(404, 'TASK_NOT_FOUND', 'Tarefa não encontrada');

/** Parâmetro de rota malformado responde como tarefa inexistente (sem oráculo, sem 500). */
function parseParams<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): z.output<TSchema> {
  const result = schema.safeParse(request.params);
  if (!result.success) throw taskNotFound();
  return result.data;
}

function parseQuery<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): z.output<TSchema> {
  const result = schema.safeParse(request.query);
  if (result.success) return result.data;
  throw new HttpError(400, 'VALIDATION_FAILED', 'Dados inválidos', {
    violations: result.error.issues.map((issue) => ({
      field: issue.path.join('.') || '(query)',
      message: issue.message,
    })),
  });
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

const toSummary = (view: TaskSummaryView): TaskSummary => ({
  id: view.id,
  key: view.key,
  number: view.number,
  projectId: view.projectId,
  title: view.title,
  status: { ...view.status },
  priority: view.priority,
  assignee: view.assignee && { ...view.assignee },
  dueDate: view.dueDate,
  parentTaskId: view.parentTaskId,
  isRequired: view.isRequired,
  completedAt: iso(view.completedAt),
  canceledAt: iso(view.canceledAt),
  version: view.version,
});

const toTaskDto = (view: TaskView): TaskDto => ({
  ...toSummary(view),
  description: view.description,
  createdByUserId: view.createdByUserId,
  createdAt: view.createdAt.toISOString(),
  actions: { ...view.actions, transitionTo: [...view.actions.transitionTo] },
  subtasks: view.subtasks.map(toSummary),
  blockedBy: view.blockedBy.map(toSummary),
  blocking: view.blocking.map(toSummary),
  blockingTruncated: view.blockingTruncated,
});

const toAssignable = (view: AssignableUserView): AssignableUser => ({ ...view });

/**
 * Rotas tenant-scoped de Tasks (spec 004) com caminhos **relativos**, montadas pelo composition
 * root no `createTenantScope` (ADR 0012). Rotas literais (`assignable-users`, `by-key`) antes de
 * `/:taskId`. Limites de uso (criação e escritas por usuário) ficam nos casos de uso, que contam
 * também as tentativas recusadas.
 */
export function createTasksRouter(deps: TasksHttpDependencies): Router {
  const { useCases } = deps;
  const router = Router({ mergeParams: true });
  router.use(noStore);

  router.get('/tasks', async (request, response) => {
    const page = await useCases.listTasks.execute(
      tenantRequestContextFrom(request),
      parseQuery(request, taskListQuerySchema),
    );
    response.json({
      items: page.items.map(toSummary),
      nextCursor: page.nextCursor,
    } satisfies TaskPage);
  });

  router.post('/tasks', async (request, response) => {
    const view = await useCases.createTask.execute(
      tenantRequestContextFrom(request),
      parseBody(request, createTaskRequestSchema),
    );
    response
      .status(201)
      .location(`${request.baseUrl}/tasks/${view.id}`)
      .json(toTaskDto(view) satisfies TaskDto);
  });

  router.get('/tasks/assignable-users', async (request, response) => {
    const page = await useCases.listAssignableUsers.execute(
      tenantRequestContextFrom(request),
      parseQuery(request, assignableUsersQuerySchema),
    );
    response.json({
      items: page.items.map(toAssignable),
      nextCursor: page.nextCursor,
    } satisfies AssignableUserPage);
  });

  router.get('/tasks/by-key/:key', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { key } = parseParams(request, taskKeyParamSchema);
    response.json(toTaskDto(await useCases.getTask.execute(context, { key })) satisfies TaskDto);
  });

  router.get('/tasks/:taskId', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { taskId } = parseParams(request, taskIdParamSchema);
    response.json(toTaskDto(await useCases.getTask.execute(context, { taskId })) satisfies TaskDto);
  });

  router.patch('/tasks/:taskId', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { taskId } = parseParams(request, taskIdParamSchema);
    const view = await useCases.updateTask.execute(context, {
      taskId,
      ...parseBody(request, updateTaskRequestSchema),
    });
    response.json(toTaskDto(view) satisfies TaskDto);
  });

  router.put('/tasks/:taskId/assignee', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { taskId } = parseParams(request, taskIdParamSchema);
    const view = await useCases.assignTask.execute(context, {
      taskId,
      ...parseBody(request, assignTaskRequestSchema),
    });
    response.json(toTaskDto(view) satisfies TaskDto);
  });

  router.post('/tasks/:taskId/transition', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { taskId } = parseParams(request, taskIdParamSchema);
    const view = await useCases.transitionTask.execute(context, {
      taskId,
      ...parseBody(request, transitionTaskRequestSchema),
    });
    response.json(toTaskDto(view) satisfies TaskDto);
  });

  for (const [action, useCase] of [
    ['cancel', useCases.cancelTask],
    ['reopen', useCases.reopenTask],
  ] as const) {
    router.post(`/tasks/:taskId/${action}`, async (request, response) => {
      const context = tenantRequestContextFrom(request);
      const { taskId } = parseParams(request, taskIdParamSchema);
      const { version } = parseBody(request, taskVersionRequestSchema);
      response.json(
        toTaskDto(await useCase.execute(context, { taskId, version })) satisfies TaskDto,
      );
    });
  }

  router.delete('/tasks/:taskId', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { taskId } = parseParams(request, taskIdParamSchema);
    const { version } = parseQuery(request, deleteTaskQuerySchema);
    await useCases.deleteTask.execute(context, { taskId, version });
    response.status(204).end();
  });

  router.post('/tasks/:taskId/dependencies', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { taskId } = parseParams(request, taskIdParamSchema);
    const { blockingTaskId } = parseBody(request, addDependencyRequestSchema);
    const { task, created } = await useCases.addDependency.execute(context, {
      taskId,
      blockingTaskId,
    });
    // Duplicada é idempotente: 200 com o mesmo corpo.
    response.status(created ? 201 : 200).json(toTaskDto(task) satisfies TaskDto);
  });

  router.delete('/tasks/:taskId/dependencies/:blockingTaskId', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { taskId, blockingTaskId } = parseParams(request, taskDependencyParamSchema);
    await useCases.removeDependency.execute(context, { taskId, blockingTaskId });
    response.status(204).end();
  });

  return router;
}
