import {
  effectiveProjectRole,
  type OrganizationRole,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import type {
  ProjectMemberRepository,
  ProjectRepository,
  Workflow,
} from '@taskflow/backend/projects/domain';
import type { OrganizationAccess } from '../ports/organization-access';
import type { UserDirectory } from '../ports/user-directory';
import { isContributor } from '../shared/contribution';

// Casos de uso que servem à porta `ProjectAccess` de `tasks` (spec 004), ligada no composition
// root. Não são expostos por HTTP; o chamador já passou pelo escopo do tenant.

export type ProjectLookup = Readonly<{ projectId: string } | { key: string }>;

export type ProjectContribution = Readonly<{
  projectId: string;
  key: string;
  archived: boolean;
  /** Lido depois do lock (obrigação para a spec 005). */
  workflow: Workflow;
  /** Papel efetivo de cada pessoa pedida (`null` = sem acesso). */
  effectiveRoles: ReadonlyMap<string, ProjectRole | null>;
  /** Pessoas pedidas que ainda são membros da organização (ator removido ⇒ 404 do tenant). */
  organizationMembers: ReadonlySet<string>;
}>;

/**
 * Trava o projeto `FOR SHARE` (BR-026 contra arquivamento concorrente) e as memberships das
 * pessoas indicadas `FOR SHARE` (contra mudança de papel e remoção na organização); lê as
 * participações sem lock — toda mudança delas trava o projeto ou a membership (invariante do
 * design da spec 004). Não trava a organização. `null` se o projeto não existir.
 */
export class LockProjectForContributionUseCase {
  constructor(
    private readonly deps: {
      readonly projects: ProjectRepository;
      readonly projectMembers: ProjectMemberRepository;
      readonly organizationAccess: OrganizationAccess;
    },
  ) {}

  async execute(
    organizationId: string,
    lookup: ProjectLookup,
    userIds: ReadonlyArray<string>,
  ): Promise<ProjectContribution | null> {
    const project = await this.deps.projects.lockForShare(organizationId, lookup);
    if (!project) return null;
    const organizationRoles = await this.deps.organizationAccess.lockMembersForShare(
      organizationId,
      userIds,
    );
    const participations = await this.deps.projectMembers.rolesOf(
      organizationId,
      project.id,
      userIds,
    );
    const { key, archivedAt } = project.toSnapshot();
    return {
      projectId: project.id,
      key: key.value,
      archived: archivedAt !== null,
      workflow: await this.deps.projects.findWorkflow(organizationId, project.id),
      organizationMembers: new Set(organizationRoles.keys()),
      effectiveRoles: new Map(
        userIds.map((userId) => {
          const organizationRole = organizationRoles.get(userId);
          return [
            userId,
            organizationRole
              ? effectiveProjectRole(organizationRole, participations.get(userId) ?? null)
              : null,
          ] as const;
        }),
      ),
    };
  }
}

export type ProjectForRead = Readonly<{
  projectId: string;
  key: string;
  archived: boolean;
  workflow: Workflow;
  effectiveRole: ProjectRole;
}>;

/**
 * Leitura: projeto visível ao leitor numa única consulta (sem diferença entre "não existe" e
 * "sem acesso"), por id ou chave, com o papel do contexto da requisição. `null` = sem acesso.
 */
export class ResolveProjectForReadUseCase {
  constructor(private readonly deps: { readonly projects: ProjectRepository }) {}

  async execute(
    organizationId: string,
    lookup: ProjectLookup,
    viewer: Readonly<{ userId: string; organizationRole: OrganizationRole }>,
  ): Promise<ProjectForRead | null> {
    const seesAll = viewer.organizationRole === 'owner' || viewer.organizationRole === 'admin';
    const visible = await this.deps.projects.findVisible(organizationId, lookup, {
      userId: viewer.userId,
      seesAll,
    });
    const effectiveRole = visible
      ? effectiveProjectRole(viewer.organizationRole, visible.participation)
      : null;
    if (!visible || !effectiveRole) return null;
    const { key, archivedAt } = visible.project.toSnapshot();
    return {
      projectId: visible.project.id,
      key: key.value,
      archived: archivedAt !== null,
      workflow: await this.deps.projects.findWorkflow(organizationId, visible.project.id),
      effectiveRole,
    };
  }
}

export type AssignableUser = Readonly<{
  userId: string;
  name: string | null;
  email: string | null;
  effectiveRole: ProjectRole;
}>;

/**
 * Quem pode ser responsável (BR-003): participantes com papel efetivo manager/member e depois
 * owners/admins da organização (D1 da spec 003: não são participantes gravados). Cursor em duas
 * fases (`p:` participantes, `o:` organização), consultas fixas por página.
 */
export class ListAssignableUsersUseCase {
  constructor(
    private readonly deps: {
      readonly projectMembers: ProjectMemberRepository;
      readonly organizationAccess: OrganizationAccess;
      readonly users: UserDirectory;
    },
  ) {}

  async execute(
    organizationId: string,
    projectId: string,
    page: Readonly<{ limit: number; cursor: string | null }>,
  ): Promise<Readonly<{ items: AssignableUser[]; nextCursor: string | null }>> {
    const phase = page.cursor?.startsWith('o:') ? 'organization' : 'project';
    const inner = page.cursor && page.cursor.length > 2 ? page.cursor.slice(2) : null;
    let candidates: Array<{ userId: string; effectiveRole: ProjectRole }>;
    let nextCursor: string | null;
    if (phase === 'project') {
      const members = await this.deps.projectMembers.listPage(
        organizationId,
        projectId,
        { limit: page.limit, cursor: inner },
        ['manager', 'member'],
      );
      const roles = await this.deps.organizationAccess.rolesOf(
        organizationId,
        members.items.map((member) => member.userId),
      );
      candidates = members.items.flatMap((member) => {
        const organizationRole = roles.get(member.userId);
        // Owner/admin aparecem na fase da organização (como manager); viewer não contribui.
        if (!organizationRole || organizationRole === 'owner' || organizationRole === 'admin')
          return [];
        const effectiveRole = effectiveProjectRole(organizationRole, member.role);
        return effectiveRole && isContributor(effectiveRole)
          ? [{ userId: member.userId, effectiveRole }]
          : [];
      });
      nextCursor = members.nextCursor ? `p:${members.nextCursor}` : 'o:';
    } else {
      const managers = await this.deps.organizationAccess.listMembersPage({
        organizationId,
        excludeUserIds: [],
        roles: ['owner', 'admin'],
        limit: page.limit,
        cursor: inner,
      });
      candidates = managers.items.map((item) => ({
        userId: item.userId,
        effectiveRole: 'manager',
      }));
      nextCursor = managers.nextCursor ? `o:${managers.nextCursor}` : null;
    }
    const accounts =
      candidates.length === 0
        ? new Map()
        : await this.deps.users.getAccounts(candidates.map((candidate) => candidate.userId));
    return {
      items: candidates.map((candidate) => {
        const account = accounts.get(candidate.userId);
        return { ...candidate, name: account?.name ?? null, email: account?.email ?? null };
      }),
      nextCursor,
    };
  }
}

/** Teto de ids de leitores devolvidos (spec 010): participantes (≤ 500) + owners e admins. */
export const MAX_PROJECT_READER_IDS = 1000;

export type ProjectReaderIds = Readonly<{
  userIds: ReadonlyArray<string>;
  /** `false` se havia mais leitores que o teto (quem chama recusa). */
  complete: boolean;
}>;

const READER_PAGE = 200;

/**
 * Quem lê o projeto (spec 010, candidatos a menção): participantes com papel efetivo (inclusive
 * viewers) e owners/admins da organização (D1 da spec 003: não são participantes gravados). Só ids,
 * sem paginar para fora: nome e e-mail são filtrados por `identity`.
 */
export class ListProjectReaderIdsUseCase {
  constructor(
    private readonly deps: {
      readonly projectMembers: ProjectMemberRepository;
      readonly organizationAccess: OrganizationAccess;
    },
  ) {}

  async execute(organizationId: string, projectId: string): Promise<ProjectReaderIds> {
    const readers = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await this.deps.projectMembers.listPage(organizationId, projectId, {
        limit: READER_PAGE,
        cursor,
      });
      const roles = await this.deps.organizationAccess.rolesOf(
        organizationId,
        page.items.map((member) => member.userId),
      );
      for (const member of page.items) {
        const organizationRole = roles.get(member.userId);
        if (organizationRole && effectiveProjectRole(organizationRole, member.role)) {
          readers.add(member.userId);
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== null && readers.size <= MAX_PROJECT_READER_IDS);
    cursor = null;
    while (readers.size <= MAX_PROJECT_READER_IDS) {
      const managers = await this.deps.organizationAccess.listMembersPage({
        organizationId,
        excludeUserIds: [],
        roles: ['owner', 'admin'],
        limit: READER_PAGE,
        cursor,
      });
      for (const item of managers.items) readers.add(item.userId);
      cursor = managers.nextCursor;
      if (cursor === null) break;
    }
    const complete = readers.size <= MAX_PROJECT_READER_IDS;
    return { userIds: [...readers].slice(0, MAX_PROJECT_READER_IDS), complete };
  }
}

/** Teto de ids por consulta em lote (spec 008: uma página de notificações). */
export const MAX_READABLE_PROJECTS_QUERY = 200;

/**
 * Spec 008 (porta `ProjectAccess` de `tasks` → `NotificationTargets`): quais dos projetos dados o
 * leitor vê agora, numa consulta, sem workflow. Ausente do mapa = não visível (falha fechado).
 */
export class ResolveReadableProjectsUseCase {
  constructor(private readonly deps: { readonly projects: ProjectRepository }) {}

  async execute(
    organizationId: string,
    projectIds: ReadonlyArray<string>,
    viewer: Readonly<{ userId: string; organizationRole: OrganizationRole }>,
  ): Promise<ReadonlyMap<string, Readonly<{ key: string }>>> {
    const unique = [...new Set(projectIds)];
    if (unique.length > MAX_READABLE_PROJECTS_QUERY) {
      // Erro de programação de quem chama (lotes são de uma página), não entrada do usuário.
      throw new RangeError(`At most ${MAX_READABLE_PROJECTS_QUERY} projects per query`);
    }
    if (unique.length === 0) return new Map();
    const seesAll = viewer.organizationRole === 'owner' || viewer.organizationRole === 'admin';
    const visible = await this.deps.projects.findVisibleMany(organizationId, unique, {
      userId: viewer.userId,
      seesAll,
    });
    return new Map(
      visible.flatMap(({ project, participation }) =>
        effectiveProjectRole(viewer.organizationRole, participation)
          ? [[project.id, { key: project.toSnapshot().key.value }] as const]
          : [],
      ),
    );
  }
}
