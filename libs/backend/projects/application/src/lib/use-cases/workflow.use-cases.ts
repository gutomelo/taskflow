import {
  RateLimitedError,
  type RateLimiter,
  type RateLimitPolicy,
  type TenantRequestContext,
  type TransactionRunner,
} from '@taskflow/backend/shared/application';
import {
  VersionConflictError,
  type Clock,
  type IdGenerator,
} from '@taskflow/backend/shared/kernel';
import {
  addStatus,
  changeCategory,
  ProjectArchivedError,
  removeStatus,
  renameStatus,
  reorderStatuses,
  replaceTransitions,
  type ProjectMemberRepository,
  type ProjectRepository,
  type StatusCategory,
  type StatusUsage,
  type Workflow,
  type WorkflowStatus,
  type WorkflowTransition,
} from '@taskflow/backend/projects/domain';
import type { OrganizationAccess } from '../ports/organization-access';
import type { WorkflowStatusUsage } from '../ports/workflow-status-usage';
import { findReadableProject } from '../shared/project-read';
import { lockProjectAndRereadActor } from '../shared/project-lock';
import type { ProjectsSecurityEventRecorder } from '../shared/projects-security-events';

/** RNF-05 da spec 005: edições de workflow por usuário. */
export const WORKFLOW_WRITE_POLICY = {
  name: 'projects.workflow.write.user.hour',
  points: 120,
  durationSeconds: 60 * 60,
} as const satisfies RateLimitPolicy;

/** Espera máxima por lock nas edições do workflow (B8 da segurança, igual às escritas de tarefa). */
const WORKFLOW_LOCK_TIMEOUT_MS = 2_000;

export type WorkflowView = Readonly<{
  version: number;
  statuses: ReadonlyArray<WorkflowStatus & Readonly<{ inUse: boolean }>>;
  transitions: ReadonlyArray<WorkflowTransition>;
}>;

export interface WorkflowDependencies {
  readonly organizationAccess: OrganizationAccess;
  readonly projects: ProjectRepository;
  readonly projectMembers: ProjectMemberRepository;
  readonly workflowStatusUsage: WorkflowStatusUsage;
  readonly transactions: TransactionRunner;
  readonly rateLimiter: RateLimiter;
  readonly securityEvents: ProjectsSecurityEventRecorder;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

const toView = (workflow: Workflow, version: number, usage: StatusUsage): WorkflowView => ({
  version,
  statuses: [...workflow.statuses]
    .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
    .map((status) => ({ ...status, inUse: (usage.get(status.id) ?? 0) > 0 })),
  transitions: workflow.transitions,
});

/** RF-01 (spec 005): o workflow com versão e "em uso" por status (leitura). */
export class GetWorkflowUseCase {
  constructor(
    private readonly deps: Pick<WorkflowDependencies, 'projects' | 'workflowStatusUsage'>,
  ) {}

  async execute(context: TenantRequestContext, projectId: string): Promise<WorkflowView> {
    const { organizationId } = context.tenant;
    await findReadableProject(this.deps.projects, context, { projectId });
    const [workflow, version, usage] = await Promise.all([
      this.deps.projects.findWorkflow(organizationId, projectId),
      this.deps.projects.workflowVersion(organizationId, projectId),
      this.deps.workflowStatusUsage.statusUsage(organizationId, projectId),
    ]);
    return toView(workflow, version ?? 1, usage);
  }
}

type Edit = Readonly<{
  workflow: Workflow;
  /** Reatribuição antes de gravar (remoção de status com tarefas). */
  reassign?: Readonly<{ fromStatusId: string; toStatusId: string }>;
  change:
    | 'status_added'
    | 'status_updated'
    | 'status_removed'
    | 'statuses_reordered'
    | 'transitions_replaced';
}>;

/**
 * Casca comum das edições (BR-030, BR-008, BR-026): limite → transação com `lock_timeout` →
 * organização `FOR SHARE` e projeto `FOR NO KEY UPDATE` com o ator relido (404 → 403 por
 * `board:configure`) → arquivado → versão do workflow → workflow e uso relidos → edição pura →
 * reatribuição → gravação. Evento depois do commit.
 */
async function editWorkflow(
  deps: WorkflowDependencies,
  context: TenantRequestContext,
  command: Readonly<{ projectId: string; version: number }>,
  edit: (workflow: Workflow, usage: StatusUsage) => Edit,
): Promise<WorkflowView> {
  const decision = await deps.rateLimiter.consume(WORKFLOW_WRITE_POLICY, context.actor.userId);
  if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
  const { organizationId } = context.tenant;
  const outcome = await deps.transactions.run(
    async () => {
      const { project } = await lockProjectAndRereadActor(deps, context, {
        projectId: command.projectId,
        permission: 'board:configure',
      });
      if (project.isArchived) throw new ProjectArchivedError();
      const version = await deps.projects.workflowVersion(organizationId, project.id);
      if (version !== command.version) throw new VersionConflictError('Workflow');
      const [workflow, usage] = await Promise.all([
        deps.projects.findWorkflow(organizationId, project.id),
        deps.workflowStatusUsage.statusUsage(organizationId, project.id),
      ]);
      const result = edit(workflow, usage);
      const counts = new Map(usage);
      let reassigned = 0;
      if (result.reassign) {
        const { fromStatusId, toStatusId } = result.reassign;
        reassigned = await deps.workflowStatusUsage.reassignStatus(
          organizationId,
          project.id,
          fromStatusId,
          toStatusId,
        );
        counts.set(toStatusId, (counts.get(toStatusId) ?? 0) + reassigned);
        counts.delete(fromStatusId);
      }
      await deps.projects.saveWorkflow(organizationId, project.id, result.workflow, version);
      return {
        view: toView(result.workflow, version + 1, counts),
        change: result.change,
        reassigned,
      };
    },
    { lockTimeoutMs: WORKFLOW_LOCK_TIMEOUT_MS },
  );
  deps.securityEvents.record({
    type: 'projects.workflow_changed',
    requestId: context.requestId,
    organizationId,
    actorUserId: context.actor.userId,
    projectId: command.projectId,
    change: outcome.change,
    reassignedTasks: outcome.reassigned,
  });
  return outcome.view;
}

export type CreateStatusCommand = Readonly<{
  projectId: string;
  name: string;
  category: StatusCategory;
  version: number;
}>;

/** RF-05: status novo no fim do workflow, sem transições. */
export class CreateStatusUseCase {
  constructor(private readonly deps: WorkflowDependencies) {}

  execute(context: TenantRequestContext, command: CreateStatusCommand): Promise<WorkflowView> {
    return editWorkflow(this.deps, context, command, (workflow) => ({
      workflow: addStatus(workflow, {
        id: this.deps.idGenerator.generate(),
        name: command.name,
        category: command.category,
      }),
      change: 'status_added',
    }));
  }
}

export type UpdateStatusCommand = Readonly<{
  projectId: string;
  statusId: string;
  name?: string;
  category?: StatusCategory;
  version: number;
}>;

/** RF-06/RF-07: renomear e/ou mudar a categoria (só sem tarefas). */
export class UpdateStatusUseCase {
  constructor(private readonly deps: WorkflowDependencies) {}

  execute(context: TenantRequestContext, command: UpdateStatusCommand): Promise<WorkflowView> {
    return editWorkflow(this.deps, context, command, (workflow, usage) => {
      let next = workflow;
      if (command.name !== undefined) next = renameStatus(next, command.statusId, command.name);
      if (command.category !== undefined) {
        next = changeCategory(next, command.statusId, command.category, usage);
      }
      return { workflow: next, change: 'status_updated' };
    });
  }
}

export type RemoveStatusCommand = Readonly<{
  projectId: string;
  statusId: string;
  moveTasksToStatusId?: string;
  version: number;
}>;

/** RF-08 (D2): remove; com tarefas, reatribui para um status da mesma categoria na mesma transação. */
export class RemoveStatusUseCase {
  constructor(private readonly deps: WorkflowDependencies) {}

  execute(context: TenantRequestContext, command: RemoveStatusCommand): Promise<WorkflowView> {
    return editWorkflow(this.deps, context, command, (workflow, usage) => {
      const removed = removeStatus(
        workflow,
        command.statusId,
        command.moveTasksToStatusId ?? null,
        usage,
      );
      return {
        workflow: removed.workflow,
        ...(removed.targetStatusId === null
          ? {}
          : { reassign: { fromStatusId: command.statusId, toStatusId: removed.targetStatusId } }),
        change: 'status_removed',
      };
    });
  }
}

/** RF-06: nova ordem das colunas (exatamente os status do workflow). */
export class ReorderStatusesUseCase {
  constructor(private readonly deps: WorkflowDependencies) {}

  execute(
    context: TenantRequestContext,
    command: Readonly<{ projectId: string; statusIds: ReadonlyArray<string>; version: number }>,
  ): Promise<WorkflowView> {
    return editWorkflow(this.deps, context, command, (workflow) => ({
      workflow: reorderStatuses(workflow, command.statusIds),
      change: 'statuses_reordered',
    }));
  }
}

/** RF-09: substitui o conjunto de transições permitidas. */
export class ReplaceTransitionsUseCase {
  constructor(private readonly deps: WorkflowDependencies) {}

  execute(
    context: TenantRequestContext,
    command: Readonly<{
      projectId: string;
      transitions: ReadonlyArray<WorkflowTransition>;
      version: number;
    }>,
  ): Promise<WorkflowView> {
    return editWorkflow(this.deps, context, command, (workflow) => ({
      workflow: replaceTransitions(workflow, command.transitions),
      change: 'transitions_replaced',
    }));
  }
}
