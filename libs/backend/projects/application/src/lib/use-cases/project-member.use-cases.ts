import {
  toPageRequest,
  type PageQuery,
  type TenantRequestContext,
  type TransactionRunner,
} from '@taskflow/backend/shared/application';
import {
  canOnProject,
  effectiveProjectRole,
  VersionConflictError,
  type Clock,
  type IdGenerator,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import {
  AlreadyAProjectMemberError,
  NotAnOrganizationMemberError,
  ProjectArchivedError,
  ProjectMember,
  type ProjectMemberRepository,
  type ProjectRepository,
} from '@taskflow/backend/projects/domain';
import type { OrganizationAccess } from '../ports/organization-access';
import type { ProjectContributorChanges } from '../ports/project-contributor-changes';
import type { UserDirectory } from '../ports/user-directory';
import { isContributor } from '../shared/contribution';
import {
  toMemberCandidateView,
  toProjectMemberView,
  type MemberCandidateView,
  type ProjectMemberView,
} from '../shared/project-member-views';
import { MAX_MEMBERS_PER_PROJECT } from '../shared/project-limits';
import { lockProjectAndRereadActor } from '../shared/project-lock';
import { findReadableProject } from '../shared/project-read';
import {
  InsufficientRoleError,
  ProjectMemberLimitReachedError,
  ProjectMemberNotFoundError,
} from '../shared/projects-errors';
import type { ProjectsSecurityEventRecorder } from '../shared/projects-security-events';

export interface ProjectMembersDependencies {
  readonly organizationAccess: OrganizationAccess;
  readonly projects: ProjectRepository;
  readonly projectMembers: ProjectMemberRepository;
  readonly users: UserDirectory;
  readonly transactions: TransactionRunner;
  readonly securityEvents: ProjectsSecurityEventRecorder;
  /** Spec 004: quem deixou de contribuir tem as atribuições desfeitas (BR-003), na mesma transação. */
  readonly contributorChanges: ProjectContributorChanges;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * RF-06: participantes com papel efetivo e as ações do leitor sobre cada um. Número fixo de
 * consultas por página: projeto visível, participantes, papéis na organização e contas.
 */
export class ListProjectMembersUseCase {
  constructor(
    private readonly deps: Pick<
      ProjectMembersDependencies,
      'projects' | 'projectMembers' | 'organizationAccess' | 'users'
    >,
  ) {}

  async execute(
    context: TenantRequestContext,
    query: PageQuery & Readonly<{ projectId: string }>,
  ): Promise<Page<ProjectMemberView>> {
    const { organizationId } = context.tenant;
    const { project, myRole } = await findReadableProject(this.deps.projects, context, {
      projectId: query.projectId,
    });
    const page = await this.deps.projectMembers.listPage(
      organizationId,
      query.projectId,
      toPageRequest(query),
    );
    const userIds = page.items.map((member) => member.userId);
    const [roles, accounts] =
      userIds.length === 0
        ? [new Map(), new Map()]
        : await Promise.all([
            this.deps.organizationAccess.rolesOf(organizationId, userIds),
            this.deps.users.getAccounts(userIds),
          ]);
    const viewer = {
      userId: context.actor.userId,
      effectiveRole: myRole,
      archived: project.isArchived,
    };
    return {
      // Participação sem membership só existe por corrida com uma remoção (a FK apaga): omitida.
      items: page.items.flatMap((member) => {
        const organizationRole = roles.get(member.userId);
        return organizationRole
          ? [toProjectMemberView(member, organizationRole, accounts.get(member.userId), viewer)]
          : [];
      }),
      nextCursor: page.nextCursor,
    };
  }
}

/**
 * Candidatos a participante (membros da organização que não participam), com os papéis que o
 * teto permite. Owner/admin ficam de fora (D1), filtrados na consulta para as páginas virem
 * cheias. Exige `project-member:manage`; projeto arquivado ⇒ 409 (não há o que adicionar).
 */
export class ListMemberCandidatesUseCase {
  constructor(
    private readonly deps: Pick<
      ProjectMembersDependencies,
      'projects' | 'projectMembers' | 'organizationAccess' | 'users'
    >,
  ) {}

  async execute(
    context: TenantRequestContext,
    query: PageQuery & Readonly<{ projectId: string }>,
  ): Promise<Page<MemberCandidateView>> {
    const { organizationId } = context.tenant;
    const { project, myRole } = await findReadableProject(this.deps.projects, context, {
      projectId: query.projectId,
    });
    if (!canOnProject(myRole, 'project-member:manage', { ownsResource: false })) {
      throw new InsufficientRoleError();
    }
    if (project.isArchived) throw new ProjectArchivedError();
    const participants = await this.deps.projectMembers.listUserIds(
      organizationId,
      query.projectId,
    );
    const { limit, cursor } = toPageRequest(query);
    const page = await this.deps.organizationAccess.listMembersPage({
      organizationId,
      excludeUserIds: participants,
      roles: ['member', 'viewer'],
      limit,
      cursor,
    });
    const accounts =
      page.items.length === 0
        ? new Map()
        : await this.deps.users.getAccounts(page.items.map((item) => item.userId));
    return {
      items: page.items.map((item) =>
        toMemberCandidateView(item.userId, item.role, accounts.get(item.userId)),
      ),
      nextCursor: page.nextCursor,
    };
  }
}

export type AddProjectMemberCommand = Readonly<{
  projectId: string;
  userId: string;
  role: ProjectRole;
}>;

/**
 * RF-07 (BR-026, BR-027): ordem de decisão fixa — projeto visível → permissão → arquivado → alvo
 * membro → owner/admin (D1) e teto → duplicidade → limite. Papéis relidos sob `FOR SHARE`.
 */
export class AddProjectMemberUseCase {
  constructor(private readonly deps: ProjectMembersDependencies) {}

  async execute(
    context: TenantRequestContext,
    command: AddProjectMemberCommand,
  ): Promise<ProjectMemberView> {
    const { organizationId } = context.tenant;
    const outcome = await this.deps.transactions.run(async () => {
      const locked = await lockProjectAndRereadActor(this.deps, context, {
        projectId: command.projectId,
        permission: 'project-member:manage',
        alsoRead: [command.userId],
      });
      if (locked.project.isArchived) throw new ProjectArchivedError();
      const targetOrganizationRole = locked.access.roles.get(command.userId);
      if (!targetOrganizationRole) throw new NotAnOrganizationMemberError();
      const member = ProjectMember.create({
        id: this.deps.idGenerator.generate(),
        organizationId,
        projectId: command.projectId,
        userId: command.userId,
        role: command.role,
        organizationRole: targetOrganizationRole,
        now: this.deps.clock.now(),
      });
      if (await this.deps.projectMembers.find(organizationId, command.projectId, command.userId)) {
        throw new AlreadyAProjectMemberError();
      }
      if (
        (await this.deps.projectMembers.count(organizationId, command.projectId)) >=
        MAX_MEMBERS_PER_PROJECT
      ) {
        throw new ProjectMemberLimitReachedError();
      }
      await this.deps.projectMembers.add(member);
      return { member, targetOrganizationRole, locked };
    });

    const { member, targetOrganizationRole, locked } = outcome;
    this.deps.securityEvents.record({
      type: 'projects.member_added',
      requestId: context.requestId,
      organizationId,
      actorUserId: context.actor.userId,
      projectId: command.projectId,
      targetUserId: command.userId,
      role: command.role,
    });
    const account = (await this.deps.users.getAccounts([command.userId])).get(command.userId);
    return toProjectMemberView(member, targetOrganizationRole, account, {
      userId: context.actor.userId,
      effectiveRole: locked.actorEffectiveRole,
      archived: false,
    });
  }
}

export type ChangeProjectMemberRoleCommand = Readonly<{
  projectId: string;
  userId: string;
  role: ProjectRole;
  version: number;
}>;

/**
 * RF-08 (BR-008, BR-026, BR-027): participação localizada por `(organização, projeto, usuário)` —
 * nunca alcança outro projeto. Ações devolvidas com o papel relido (o novo, se o ator mudou o
 * próprio).
 */
export class ChangeProjectMemberRoleUseCase {
  constructor(private readonly deps: ProjectMembersDependencies) {}

  async execute(
    context: TenantRequestContext,
    command: ChangeProjectMemberRoleCommand,
  ): Promise<ProjectMemberView> {
    const { organizationId } = context.tenant;
    const actorUserId = context.actor.userId;
    const outcome = await this.deps.transactions.run(async () => {
      const locked = await lockProjectAndRereadActor(this.deps, context, {
        projectId: command.projectId,
        permission: 'project-member:manage',
        alsoRead: [command.userId],
      });
      if (locked.project.isArchived) throw new ProjectArchivedError();
      const member = await this.deps.projectMembers.find(
        organizationId,
        command.projectId,
        command.userId,
      );
      const targetOrganizationRole = locked.access.roles.get(command.userId);
      if (!member || !targetOrganizationRole) throw new ProjectMemberNotFoundError();
      if (member.version !== command.version) throw new VersionConflictError('ProjectMember');
      const fromRole = member.role;
      if (fromRole === command.role) {
        return { member, fromRole, targetOrganizationRole, locked, changed: false };
      }
      member.changeRole(command.role, targetOrganizationRole, this.deps.clock.now());
      await this.deps.projectMembers.save(member);
      // BR-003: com o papel novo, deixou de contribuir neste projeto? Decide aqui, `tasks` executa.
      if (!isContributor(effectiveProjectRole(targetOrganizationRole, command.role))) {
        await this.deps.contributorChanges.contributorAccessReduced({
          organizationId,
          userId: command.userId,
          scope: { projectId: command.projectId },
          stillContributorIn: [],
        });
      }
      return { member, fromRole, targetOrganizationRole, locked, changed: true };
    });

    const { member, fromRole, targetOrganizationRole, locked, changed } = outcome;
    if (changed) {
      this.deps.securityEvents.record({
        type: 'projects.member_role_changed',
        requestId: context.requestId,
        organizationId,
        actorUserId,
        projectId: command.projectId,
        targetUserId: command.userId,
        fromRole,
        toRole: command.role,
      });
    }
    // O papel efetivo do ator depois da operação: recalculado se ele alterou o próprio.
    const actorEffectiveRole =
      command.userId === actorUserId
        ? (effectiveProjectRole(locked.actorOrganizationRole, member.role) ??
          locked.actorEffectiveRole)
        : locked.actorEffectiveRole;
    const account = (await this.deps.users.getAccounts([command.userId])).get(command.userId);
    return toProjectMemberView(
      member,
      targetOrganizationRole,
      account,
      { userId: actorUserId, effectiveRole: actorEffectiveRole, archived: false },
      changed ? member.version + 1 : member.version,
    );
  }
}

export type RemoveProjectMemberCommand = Readonly<{
  projectId: string;
  userId: string;
  version: number;
}>;

/**
 * RF-08: remover outro participante exige `project-member:manage`; sair (o próprio) só exige
 * participar. Permitido em projeto arquivado (reduzir acesso é sempre seguro, BR-026).
 */
export class RemoveProjectMemberUseCase {
  constructor(private readonly deps: ProjectMembersDependencies) {}

  async execute(context: TenantRequestContext, command: RemoveProjectMemberCommand): Promise<void> {
    const { organizationId } = context.tenant;
    const actorUserId = context.actor.userId;
    const self = command.userId === actorUserId;
    await this.deps.transactions.run(async () => {
      const locked = await lockProjectAndRereadActor(this.deps, context, {
        projectId: command.projectId,
        // Sair só exige ver o projeto: quem não participa (owner/admin) recebe 404 do participante.
        permission: self ? 'project:read' : 'project-member:manage',
        alsoRead: [command.userId],
      });
      const member = await this.deps.projectMembers.find(
        organizationId,
        command.projectId,
        command.userId,
      );
      if (!member) throw new ProjectMemberNotFoundError();
      if (member.version !== command.version) throw new VersionConflictError('ProjectMember');
      await this.deps.projectMembers.remove(
        organizationId,
        command.projectId,
        command.userId,
        command.version,
      );
      // BR-003: sem a participação, ainda contribui? Owner/admin seguem como manager (decisão 7 da
      // spec 004); member e viewer da organização deixam de contribuir neste projeto.
      const targetOrganizationRole = locked.access.roles.get(command.userId);
      if (
        !targetOrganizationRole ||
        !isContributor(effectiveProjectRole(targetOrganizationRole, null))
      ) {
        await this.deps.contributorChanges.contributorAccessReduced({
          organizationId,
          userId: command.userId,
          scope: { projectId: command.projectId },
          stillContributorIn: [],
        });
      }
    });

    this.deps.securityEvents.record({
      type: 'projects.member_removed',
      requestId: context.requestId,
      organizationId,
      actorUserId,
      projectId: command.projectId,
      targetUserId: command.userId,
      self,
    });
  }
}
