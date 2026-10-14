import type { TenantRequestContext } from '@taskflow/backend/shared/application';
import { canOnProject } from '@taskflow/backend/shared/kernel';
import {
  initialStatus,
  parseDueDate,
  parseTaskDescription,
  ParentTaskCompletedError,
  SubtaskDepthError,
  Task,
  TaskNotFoundError,
  TaskTitle,
  type Priority,
} from '@taskflow/backend/tasks/domain';
import { isContributor } from '../shared/contribution';
import {
  MAX_SUBTASKS_PER_TASK,
  MAX_TASKS_PER_ORGANIZATION,
  MAX_TASKS_PER_PROJECT,
  TASK_CREATION_POLICY,
} from '../shared/task-limits';
import type { TaskView } from '../shared/task-views';
import { eventBase, runTaskWrite, type TaskWriteOutcome } from '../shared/task-write';
import type { TasksDependencies } from '../shared/tasks-dependencies';
import {
  AssigneeNotProjectMemberError,
  InsufficientRoleError,
  OrganizationNotFoundError,
  ProjectArchivedError,
  ProjectNotFoundError,
  SubtaskLimitReachedError,
  TaskLimitReachedError,
} from '../shared/tasks-errors';

export type CreateTaskCommand = Readonly<{
  projectId: string;
  title: string;
  description?: string | null;
  priority?: Priority;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  parentTaskId?: string | null;
  isRequired?: boolean;
}>;

/**
 * RF-01/RF-02 (BR-028, BR-001, BR-003): cria tarefa ou subtarefa (um nível) no primeiro status
 * `todo`, com o próximo número do projeto. Subtarefa trava o projeto em `tasks` (BR-001 contra a
 * conclusão concorrente do pai e teto de subtarefas).
 */
export class CreateTaskUseCase {
  constructor(private readonly deps: TasksDependencies) {}

  execute(context: TenantRequestContext, command: CreateTaskCommand): Promise<TaskView> {
    // Conta a tentativa antes de tudo (inclusive as recusadas).
    return runTaskWrite(this.deps, context, TASK_CREATION_POLICY, () =>
      this.createWithinTransaction(context, command),
    );
  }

  /** Núcleo: roda na transação do chamador e devolve os eventos para depois do commit. */
  async createWithinTransaction(
    context: TenantRequestContext,
    command: CreateTaskCommand,
  ): Promise<TaskWriteOutcome> {
    const { organizationId } = context.tenant;
    const actorUserId = context.actor.userId;
    const title = TaskTitle.create(command.title);
    const description = parseTaskDescription(command.description ?? null);
    const dueDate = parseDueDate(command.dueDate ?? null);
    const assigneeUserId = command.assigneeUserId ?? null;
    const parentTaskId = command.parentTaskId ?? null;

    const locked = await this.deps.projectAccess.lockForContribution(
      organizationId,
      { projectId: command.projectId },
      assigneeUserId === null ? [actorUserId] : [actorUserId, assigneeUserId],
    );
    if (!locked) throw new ProjectNotFoundError();
    if (!locked.organizationMembers.has(actorUserId)) throw new OrganizationNotFoundError();
    const role = locked.effectiveRoles.get(actorUserId) ?? null;
    if (!role) throw new ProjectNotFoundError();
    const may = (permission: 'task:create' | 'task:assign') =>
      canOnProject(role, permission, { ownsResource: false });
    if (!may('task:create') || (assigneeUserId !== null && !may('task:assign'))) {
      throw new InsufficientRoleError();
    }
    if (locked.archived) throw new ProjectArchivedError();
    const { projectId } = locked;

    if (parentTaskId !== null) {
      await this.deps.tasks.lockProject(organizationId, projectId);
      const [parent] = await this.deps.tasks.findByIds(organizationId, projectId, [parentTaskId]);
      if (!parent) throw new TaskNotFoundError();
      if (parent.parentTaskId !== null) throw new SubtaskDepthError();
      // D1: obrigatória nasce pendente; pai concluído não pode ganhar pendência.
      if (command.isRequired === true && parent.isCompleted) throw new ParentTaskCompletedError();
      const siblings = await this.deps.tasks.subtasksOf(organizationId, projectId, parentTaskId);
      if (siblings.length >= MAX_SUBTASKS_PER_TASK) throw new SubtaskLimitReachedError();
    }
    if (assigneeUserId !== null && !isContributor(locked.effectiveRoles.get(assigneeUserId))) {
      throw new AssigneeNotProjectMemberError();
    }
    if ((await this.deps.tasks.countInOrganization(organizationId)) >= MAX_TASKS_PER_ORGANIZATION) {
      throw new TaskLimitReachedError();
    }
    const number = await this.deps.tasks.nextNumber(organizationId, projectId);
    // Sobre o contador (inclui excluídas); o rollback devolve o número consumido.
    if (number > MAX_TASKS_PER_PROJECT) throw new TaskLimitReachedError();
    const status = initialStatus(locked.workflow);
    if (!status) throw new Error(`Project ${projectId} has no status of category todo`);

    const task = Task.create({
      id: this.deps.idGenerator.generate(),
      organizationId,
      projectId,
      number,
      title,
      description,
      status,
      priority: command.priority ?? 'none',
      assigneeUserId,
      dueDate,
      parentTaskId,
      isRequired: command.isRequired ?? false,
      createdByUserId: actorUserId,
      now: this.deps.clock.now(),
    });
    await this.deps.tasks.add(task);

    const base = eventBase(context, task);
    return {
      task,
      projectContext: {
        projectId,
        key: locked.key,
        archived: locked.archived,
        workflow: locked.workflow,
        effectiveRole: role,
      },
      events: [
        { ...base, type: 'tasks.created' },
        ...(assigneeUserId === null
          ? []
          : [
              {
                ...base,
                type: 'tasks.assigned' as const,
                fromUserId: null,
                toUserId: assigneeUserId,
              },
            ]),
      ],
    };
  }
}
