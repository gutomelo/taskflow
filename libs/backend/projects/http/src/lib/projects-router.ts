import { Router, type Request } from 'express';
import type { RateLimiter, RateLimitPolicy } from '@taskflow/backend/shared/application';
import {
  createRateLimit,
  HttpError,
  noStore,
  parseBody,
  tenantRequestContextFrom,
} from '@taskflow/backend/shared/http';
import type {
  AddProjectMemberUseCase,
  ArchiveProjectUseCase,
  ChangeProjectMemberRoleUseCase,
  CreateProjectUseCase,
  GetProjectUseCase,
  CreateStatusUseCase,
  GetWorkflowUseCase,
  ListMemberCandidatesUseCase,
  ListProjectMembersUseCase,
  ListProjectsUseCase,
  MemberCandidateView,
  ProjectMemberView,
  ProjectSummaryView,
  ProjectView,
  RemoveProjectMemberUseCase,
  RemoveStatusUseCase,
  ReorderStatusesUseCase,
  ReplaceTransitionsUseCase,
  RestoreProjectUseCase,
  UpdateProjectUseCase,
  UpdateStatusUseCase,
  WorkflowView,
} from '@taskflow/backend/projects/application';
import {
  addProjectMemberRequestSchema,
  createStatusRequestSchema,
  changeProjectMemberRoleRequestSchema,
  createProjectRequestSchema,
  pageQuerySchema,
  projectIdParamSchema,
  projectKeyParamSchema,
  projectListQuerySchema,
  projectMemberParamSchema,
  projectVersionRequestSchema,
  removeProjectMemberQuerySchema,
  removeStatusQuerySchema,
  reorderStatusesRequestSchema,
  replaceTransitionsRequestSchema,
  statusParamSchema,
  updateProjectRequestSchema,
  updateStatusRequestSchema,
  type MemberCandidate,
  type MemberCandidatePage,
  type ProjectDto,
  type ProjectMemberDto,
  type ProjectMemberPage,
  type ProjectPage,
  type ProjectSummary,
  type WorkflowDto,
} from '@taskflow/contracts';
import type { z } from 'zod';
import { PROJECTS_RATE_LIMITS, userKey } from './projects-rate-limits';

type Executes<T extends { execute: (...args: never[]) => unknown }> = Pick<T, 'execute'>;

export interface ProjectsHttpDependencies {
  readonly useCases: Readonly<{
    createProject: Executes<CreateProjectUseCase>;
    listProjects: Executes<ListProjectsUseCase>;
    getProject: Executes<GetProjectUseCase>;
    getWorkflow: Executes<GetWorkflowUseCase>;
    updateProject: Executes<UpdateProjectUseCase>;
    archiveProject: Executes<ArchiveProjectUseCase>;
    restoreProject: Executes<RestoreProjectUseCase>;
    listMembers: Executes<ListProjectMembersUseCase>;
    listMemberCandidates: Executes<ListMemberCandidatesUseCase>;
    addMember: Executes<AddProjectMemberUseCase>;
    changeMemberRole: Executes<ChangeProjectMemberRoleUseCase>;
    removeMember: Executes<RemoveProjectMemberUseCase>;
    createStatus: Executes<CreateStatusUseCase>;
    updateStatus: Executes<UpdateStatusUseCase>;
    removeStatus: Executes<RemoveStatusUseCase>;
    reorderStatuses: Executes<ReorderStatusesUseCase>;
    replaceTransitions: Executes<ReplaceTransitionsUseCase>;
  }>;
  readonly rateLimiter: RateLimiter;
}

const projectNotFound = () => new HttpError(404, 'PROJECT_NOT_FOUND', 'Projeto não encontrado');
const projectMemberNotFound = () =>
  new HttpError(404, 'PROJECT_MEMBER_NOT_FOUND', 'Participante não encontrado');

/** Parâmetro de rota malformado responde como recurso inexistente (sem oráculo, sem 500). */
function parseParams<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
  notFound: () => HttpError,
): z.output<TSchema> {
  const result = schema.safeParse(request.params);
  if (!result.success) throw notFound();
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

const toProjectDto = (view: ProjectView): ProjectDto => ({
  id: view.id,
  key: view.key,
  name: view.name,
  description: view.description,
  archivedAt: view.archivedAt?.toISOString() ?? null,
  version: view.version,
  createdAt: view.createdAt.toISOString(),
  myRole: view.myRole,
  capabilities: [...view.capabilities],
});
const toSummary = (view: ProjectSummaryView): ProjectSummary => ({ ...view });
const toMemberDto = (view: ProjectMemberView): ProjectMemberDto => ({
  ...view,
  joinedAt: view.joinedAt.toISOString(),
  actions: { ...view.actions, changeRoleTo: [...view.actions.changeRoleTo] },
});
const toCandidate = (view: MemberCandidateView): MemberCandidate => ({
  ...view,
  allowedRoles: [...view.allowedRoles],
});
const toWorkflowDto = (workflow: WorkflowView): WorkflowDto => ({
  version: workflow.version,
  statuses: workflow.statuses.map((status) => ({ ...status })),
  transitions: workflow.transitions.map((transition) => ({ ...transition })),
});
const statusNotFound = () =>
  new HttpError(404, 'STATUS_NOT_FOUND', 'Status não encontrado no workflow do projeto');

/**
 * Rotas tenant-scoped de Projects (spec 003) com caminhos **relativos**: só funcionam montadas
 * pelo composition root no `createTenantScope` (ADR 0012); `tenantRequestContextFrom` falha
 * fechado fora dele. Controllers finos: validam o contrato, chamam um caso de uso e mapeiam.
 */
/** Projeto malformado ⇒ 404 do projeto; status malformado ⇒ 404 do status (sem chegar ao banco). */
function parseStatusParams(request: Request) {
  const { projectId } = parseParams(request, projectIdParamSchema, projectNotFound);
  const { statusId } = parseParams(request, statusParamSchema, statusNotFound);
  return { projectId, statusId };
}

export function createProjectsRouter(deps: ProjectsHttpDependencies): Router {
  const { useCases } = deps;
  const limit = (policy: RateLimitPolicy) =>
    createRateLimit({ limiter: deps.rateLimiter, policy, key: userKey, requireKey: true });
  const router = Router({ mergeParams: true });
  router.use(noStore);

  router.get('/projects', async (request, response) => {
    const { status, ...page } = parseQuery(request, projectListQuerySchema);
    const result = await useCases.listProjects.execute(tenantRequestContextFrom(request), {
      ...page,
      archived: status === 'archived',
    });
    response.json({
      items: result.items.map(toSummary),
      nextCursor: result.nextCursor,
    } satisfies ProjectPage);
  });

  router.post('/projects', async (request, response) => {
    const view = await useCases.createProject.execute(
      tenantRequestContextFrom(request),
      parseBody(request, createProjectRequestSchema),
    );
    response
      .status(201)
      .location(`${request.baseUrl}/projects/${view.id}`)
      .json(toProjectDto(view) satisfies ProjectDto);
  });

  // Caminho com um segmento a mais que `/:projectId`: não há ambiguidade de ordem entre os dois.
  router.get('/projects/by-key/:key', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { key } = parseParams(request, projectKeyParamSchema, projectNotFound);
    const view = await useCases.getProject.execute(context, { key });
    response.json(toProjectDto(view) satisfies ProjectDto);
  });

  router.get('/projects/:projectId', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { projectId } = parseParams(request, projectIdParamSchema, projectNotFound);
    const view = await useCases.getProject.execute(context, { projectId });
    response.json(toProjectDto(view) satisfies ProjectDto);
  });

  router.patch(
    '/projects/:projectId',
    limit(PROJECTS_RATE_LIMITS.updateByUser),
    async (request, response) => {
      const context = tenantRequestContextFrom(request);
      const { projectId } = parseParams(request, projectIdParamSchema, projectNotFound);
      const view = await useCases.updateProject.execute(context, {
        projectId,
        ...parseBody(request, updateProjectRequestSchema),
      });
      response.json(toProjectDto(view) satisfies ProjectDto);
    },
  );

  for (const [action, useCase] of [
    ['archive', useCases.archiveProject],
    ['restore', useCases.restoreProject],
  ] as const) {
    router.post(
      `/projects/:projectId/${action}`,
      limit(PROJECTS_RATE_LIMITS.archiveByUser),
      async (request, response) => {
        const context = tenantRequestContextFrom(request);
        const { projectId } = parseParams(request, projectIdParamSchema, projectNotFound);
        const { version } = parseBody(request, projectVersionRequestSchema);
        const view = await useCase.execute(context, { projectId, version });
        response.json(toProjectDto(view) satisfies ProjectDto);
      },
    );
  }

  router.get('/projects/:projectId/workflow', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { projectId } = parseParams(request, projectIdParamSchema, projectNotFound);
    const workflow = await useCases.getWorkflow.execute(context, projectId);
    response.json(toWorkflowDto(workflow) satisfies WorkflowDto);
  });

  // --- Workflow configurável (spec 005). Limites de uso nos casos de uso (contam recusas). ---
  router.post('/projects/:projectId/workflow/statuses', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { projectId } = parseParams(request, projectIdParamSchema, projectNotFound);
    const workflow = await useCases.createStatus.execute(context, {
      projectId,
      ...parseBody(request, createStatusRequestSchema),
    });
    response.status(201).json(toWorkflowDto(workflow) satisfies WorkflowDto);
  });

  router.patch('/projects/:projectId/workflow/statuses/:statusId', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { projectId, statusId } = parseStatusParams(request);
    const workflow = await useCases.updateStatus.execute(context, {
      projectId,
      statusId,
      ...parseBody(request, updateStatusRequestSchema),
    });
    response.json(toWorkflowDto(workflow) satisfies WorkflowDto);
  });

  router.delete('/projects/:projectId/workflow/statuses/:statusId', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { projectId, statusId } = parseStatusParams(request);
    const { moveTasksToStatusId, version } = parseQuery(request, removeStatusQuerySchema);
    const workflow = await useCases.removeStatus.execute(context, {
      projectId,
      statusId,
      version,
      ...(moveTasksToStatusId === undefined ? {} : { moveTasksToStatusId }),
    });
    response.json(toWorkflowDto(workflow) satisfies WorkflowDto);
  });

  router.put('/projects/:projectId/workflow/order', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { projectId } = parseParams(request, projectIdParamSchema, projectNotFound);
    const workflow = await useCases.reorderStatuses.execute(context, {
      projectId,
      ...parseBody(request, reorderStatusesRequestSchema),
    });
    response.json(toWorkflowDto(workflow) satisfies WorkflowDto);
  });

  router.put('/projects/:projectId/workflow/transitions', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { projectId } = parseParams(request, projectIdParamSchema, projectNotFound);
    const workflow = await useCases.replaceTransitions.execute(context, {
      projectId,
      ...parseBody(request, replaceTransitionsRequestSchema),
    });
    response.json(toWorkflowDto(workflow) satisfies WorkflowDto);
  });

  router.get('/projects/:projectId/members', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { projectId } = parseParams(request, projectIdParamSchema, projectNotFound);
    const page = await useCases.listMembers.execute(context, {
      projectId,
      ...parseQuery(request, pageQuerySchema),
    });
    response.json({
      items: page.items.map(toMemberDto),
      nextCursor: page.nextCursor,
    } satisfies ProjectMemberPage);
  });

  router.get('/projects/:projectId/member-candidates', async (request, response) => {
    const context = tenantRequestContextFrom(request);
    const { projectId } = parseParams(request, projectIdParamSchema, projectNotFound);
    const page = await useCases.listMemberCandidates.execute(context, {
      projectId,
      ...parseQuery(request, pageQuerySchema),
    });
    response.json({
      items: page.items.map(toCandidate),
      nextCursor: page.nextCursor,
    } satisfies MemberCandidatePage);
  });

  router.post(
    '/projects/:projectId/members',
    limit(PROJECTS_RATE_LIMITS.memberWritesByUser),
    async (request, response) => {
      const context = tenantRequestContextFrom(request);
      const { projectId } = parseParams(request, projectIdParamSchema, projectNotFound);
      const { userId, role } = parseBody(request, addProjectMemberRequestSchema);
      const view = await useCases.addMember.execute(context, { projectId, userId, role });
      response.status(201).json(toMemberDto(view) satisfies ProjectMemberDto);
    },
  );

  router.patch(
    '/projects/:projectId/members/:userId',
    limit(PROJECTS_RATE_LIMITS.memberWritesByUser),
    async (request, response) => {
      const context = tenantRequestContextFrom(request);
      const { projectId, userId } = parseParams(
        request,
        projectMemberParamSchema,
        projectMemberNotFound,
      );
      const { role, version } = parseBody(request, changeProjectMemberRoleRequestSchema);
      const view = await useCases.changeMemberRole.execute(context, {
        projectId,
        userId,
        role,
        version,
      });
      response.json(toMemberDto(view) satisfies ProjectMemberDto);
    },
  );

  router.delete(
    '/projects/:projectId/members/:userId',
    limit(PROJECTS_RATE_LIMITS.memberWritesByUser),
    async (request, response) => {
      const context = tenantRequestContextFrom(request);
      const { projectId, userId } = parseParams(
        request,
        projectMemberParamSchema,
        projectMemberNotFound,
      );
      const { version } = parseQuery(request, removeProjectMemberQuerySchema);
      await useCases.removeMember.execute(context, { projectId, userId, version });
      response.status(204).end();
    },
  );

  return router;
}
