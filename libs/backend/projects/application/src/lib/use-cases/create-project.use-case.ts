import {
  RateLimitedError,
  type RateLimiter,
  type TenantRequestContext,
  type TransactionRunner,
} from '@taskflow/backend/shared/application';
import {
  effectiveProjectRole,
  organizationGrant,
  organizationPermissions,
  type Clock,
  type IdGenerator,
} from '@taskflow/backend/shared/kernel';
import {
  defaultWorkflow,
  parseProjectDescription,
  Project,
  ProjectKey,
  ProjectMember,
  ProjectName,
  type ProjectMemberRepository,
  type ProjectRepository,
} from '@taskflow/backend/projects/domain';
import type { OrganizationAccess } from '../ports/organization-access';
import { MAX_PROJECTS_PER_ORGANIZATION, PROJECT_CREATION_POLICY } from '../shared/project-limits';
import { toProjectView, type ProjectView } from '../shared/project-views';
import {
  InsufficientRoleError,
  OrganizationNotFoundError,
  ProjectLimitReachedError,
} from '../shared/projects-errors';
import type { ProjectsSecurityEventRecorder } from '../shared/projects-security-events';

export type CreateProjectCommand = Readonly<{
  key: string;
  name: string;
  description?: string | null;
}>;

export interface CreateProjectDependencies {
  readonly organizationAccess: OrganizationAccess;
  readonly projects: ProjectRepository;
  readonly projectMembers: ProjectMemberRepository;
  readonly transactions: TransactionRunner;
  readonly rateLimiter: RateLimiter;
  readonly securityEvents: ProjectsSecurityEventRecorder;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * RF-01 (BR-024, BR-025): `project:create` com a configuração da organização lida **na mesma
 * transação**, sob `FOR SHARE` (obrigação 1 da spec 006) — desligar a configuração e criar ficam
 * serializados. O criador member vira `manager`; owner/admin não são gravados (D1).
 */
export class CreateProjectUseCase {
  constructor(private readonly deps: CreateProjectDependencies) {}

  async execute(
    context: TenantRequestContext,
    command: CreateProjectCommand,
  ): Promise<ProjectView> {
    const { organizationId, organizationRole } = context.tenant;
    const actorUserId = context.actor.userId;
    // Conta a tentativa antes de tudo: chaves recusadas também consomem (enumeração de chaves).
    const decision = await this.deps.rateLimiter.consume(PROJECT_CREATION_POLICY, actorUserId);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
    // Negação rápida só do que nunca pode (viewer); `setting` decide sob lock.
    if (organizationGrant(organizationRole, 'project:create') === 'deny') {
      throw new InsufficientRoleError();
    }
    const key = ProjectKey.create(command.key);
    const name = ProjectName.create(command.name);
    const description = parseProjectDescription(command.description ?? null);

    const outcome = await this.deps.transactions.run(async () => {
      const access = await this.deps.organizationAccess.lockForShare(organizationId, [actorUserId]);
      const actorRole = access?.roles.get(actorUserId);
      if (!access || !actorRole) throw new OrganizationNotFoundError();
      const permissions = organizationPermissions(actorRole, {
        membersCanCreateProjects: access.membersCanCreateProjects,
      });
      if (!permissions.includes('project:create')) throw new InsufficientRoleError();
      if (
        (await this.deps.projects.countInOrganization(organizationId)) >=
        MAX_PROJECTS_PER_ORGANIZATION
      ) {
        throw new ProjectLimitReachedError();
      }

      const now = this.deps.clock.now();
      const project = Project.create({
        id: this.deps.idGenerator.generate(),
        organizationId,
        key,
        name,
        description,
        createdByUserId: actorUserId,
        now,
      });
      await this.deps.projects.add(
        project,
        defaultWorkflow(() => this.deps.idGenerator.generate()),
      );
      // D1: owner/admin já gerenciam todos os projetos; só o member criador vira participante.
      const participation =
        actorRole === 'member'
          ? ProjectMember.create({
              id: this.deps.idGenerator.generate(),
              organizationId,
              projectId: project.id,
              userId: actorUserId,
              role: 'manager',
              organizationRole: actorRole,
              now,
            })
          : null;
      if (participation) await this.deps.projectMembers.add(participation);
      const myRole = effectiveProjectRole(actorRole, participation?.role ?? null);
      // Criador sempre tem papel efetivo: owner/admin ⇒ manager; member ⇒ participação gravada.
      if (!myRole) throw new InsufficientRoleError();
      return { project, myRole };
    });

    this.deps.securityEvents.record({
      type: 'projects.created',
      requestId: context.requestId,
      organizationId,
      actorUserId,
      projectId: outcome.project.id,
    });
    return toProjectView(outcome.project, outcome.myRole);
  }
}
