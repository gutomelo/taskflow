import type { Logger } from 'pino';
import type { RateLimiter, TransactionRunner } from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';
import { createProjectsRouter, projectsErrorMappings } from '@taskflow/backend/projects/http';
import {
  AddProjectMemberUseCase,
  ApplyOrganizationRoleChangeUseCase,
  ArchiveProjectUseCase,
  ChangeProjectMemberRoleUseCase,
  CreateProjectUseCase,
  GetProjectUseCase,
  GetWorkflowUseCase,
  ListMemberCandidatesUseCase,
  ListProjectMembersUseCase,
  ListProjectsUseCase,
  RemoveProjectMemberUseCase,
  RestoreProjectUseCase,
  UpdateProjectUseCase,
  type OrganizationAccess,
  type ProjectsSecurityEventRecorder,
  type UserDirectory,
} from '@taskflow/backend/projects/application';
import {
  PrismaProjectMemberRepository,
  PrismaProjectRepository,
} from '@taskflow/backend/projects/infrastructure';

export interface ProjectsFoundationDependencies {
  /** A mesma instância usada por `organizations` (as portas rodam na transação do chamador). */
  readonly transactions: PrismaTransactionRunner & TransactionRunner;
  readonly clock: Clock;
}

/**
 * Passo 1 da ordem de montagem (design da spec 003): repositórios de `projects` e a reação a
 * mudanças de papel, que dependem só deles. Vem antes de `createOrganizationsModule`, que recebe
 * a reação pela porta `MembershipRoleChanges` — sem ciclo de construção.
 */
export function createProjectsFoundation(deps: ProjectsFoundationDependencies) {
  const projects = new PrismaProjectRepository(deps.transactions);
  const projectMembers = new PrismaProjectMemberRepository(deps.transactions);
  return {
    projects,
    projectMembers,
    applyOrganizationRoleChange: new ApplyOrganizationRoleChangeUseCase({
      projectMembers,
      clock: deps.clock,
    }),
  };
}

export type ProjectsFoundation = ReturnType<typeof createProjectsFoundation>;

export interface ProjectsModuleDependencies {
  readonly foundation: ProjectsFoundation;
  readonly logger: Logger;
  readonly transactions: PrismaTransactionRunner & TransactionRunner;
  readonly rateLimiter: RateLimiter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Adaptador para `organizations` (passo 3 da ordem de montagem). */
  readonly organizationAccess: OrganizationAccess;
  /** Contas de `identity` (adaptador do composition root). */
  readonly users: UserDirectory;
}

/** Composition root do contexto Projects (spec 003): casos de uso sobre a fundação. */
export function createProjectsModule(deps: ProjectsModuleDependencies) {
  const { foundation, logger } = deps;
  // BR-007 (desvio da spec 002): eventos de segurança no log estruturado, só com ids.
  const securityEvents: ProjectsSecurityEventRecorder = {
    record: (event) => logger.warn({ securityEvent: event }, event.type),
  };
  const shared = {
    projects: foundation.projects,
    projectMembers: foundation.projectMembers,
    organizationAccess: deps.organizationAccess,
    users: deps.users,
    transactions: deps.transactions,
    rateLimiter: deps.rateLimiter,
    securityEvents,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };
  const useCases = {
    createProject: new CreateProjectUseCase(shared),
    listProjects: new ListProjectsUseCase(shared),
    getProject: new GetProjectUseCase(shared),
    getWorkflow: new GetWorkflowUseCase(shared),
    updateProject: new UpdateProjectUseCase(shared),
    archiveProject: new ArchiveProjectUseCase(shared),
    restoreProject: new RestoreProjectUseCase(shared),
    listMembers: new ListProjectMembersUseCase(shared),
    listMemberCandidates: new ListMemberCandidatesUseCase(shared),
    addMember: new AddProjectMemberUseCase(shared),
    changeMemberRole: new ChangeProjectMemberRoleUseCase(shared),
    removeMember: new RemoveProjectMemberUseCase(shared),
  };
  return {
    useCases,
    /** Rotas tenant-scoped, montadas pelo composition root no `createTenantScope`. */
    tenantRouter: createProjectsRouter({ useCases, rateLimiter: deps.rateLimiter }),
    domainErrors: projectsErrorMappings,
  };
}

export type ProjectsModule = ReturnType<typeof createProjectsModule>;
