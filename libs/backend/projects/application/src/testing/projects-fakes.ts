// Fakes em memória para os testes de casos de uso de `projects`. Nunca em produção.
import { VersionConflictError } from '@taskflow/backend/shared/kernel';
import {
  FakeTransactionRunner,
  FixedClock,
  InMemoryRateLimiter,
  SequentialIds,
  type TransactionalStore,
} from '@taskflow/backend/shared/application/testing';
import {
  AlreadyAProjectMemberError,
  NotAnOrganizationMemberError,
  Project,
  ProjectKeyTakenError,
  ProjectMember,
  type Page,
  type PageRequest,
  type ProjectMemberRepository,
  type ProjectMemberSnapshot,
  type ProjectRepository,
  type ProjectSnapshot,
  type ProjectViewer,
  type VisibleProject,
  type Workflow,
} from '@taskflow/backend/projects/domain';
import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import type { OrganizationAccess } from '../lib/ports/organization-access';
import type { WorkflowStatusUsage } from '../lib/ports/workflow-status-usage';
import type { ProjectContributorChanges } from '../lib/ports/project-contributor-changes';
import type { ProjectUserAccount, UserDirectory } from '../lib/ports/user-directory';
import type {
  ProjectsSecurityEvent,
  ProjectsSecurityEventRecorder,
} from '../lib/shared/projects-security-events';

/** Exige transação como o repositório Prisma (`transactionalClient`). */
function requireTransaction(transactions: FakeTransactionRunner, operation: string): void {
  if (!transactions.inTransaction) throw new Error(`${operation} must run inside a transaction`);
}

function pageOf<T>(all: ReadonlyArray<T>, page: PageRequest): Page<T> {
  // Cursor do fake: posição na lista (o real é keyset opaco).
  const start = page.cursor === null ? 0 : Number(page.cursor);
  const next = start + page.limit;
  return { items: all.slice(start, next), nextCursor: next < all.length ? String(next) : null };
}

export class InMemoryProjectMemberRepository
  implements ProjectMemberRepository, TransactionalStore
{
  rows: ProjectMemberSnapshot[] = [];
  /** Membros da organização (simula a FK para `memberships`, ADR 0015): `organizationId|userId`. */
  readonly organizationMembers = new Set<string>();

  constructor(private readonly transactions: FakeTransactionRunner) {}

  snapshot() {
    return [...this.rows];
  }
  restore(state: unknown) {
    this.rows = state as ProjectMemberSnapshot[];
  }

  private index(organizationId: string, projectId: string, userId: string) {
    return this.rows.findIndex(
      (row) =>
        row.organizationId === organizationId &&
        row.projectId === projectId &&
        row.userId === userId,
    );
  }

  async add(member: ProjectMember) {
    const row = member.toSnapshot();
    if (this.index(row.organizationId, row.projectId, row.userId) >= 0) {
      throw new AlreadyAProjectMemberError();
    }
    if (!this.organizationMembers.has(`${row.organizationId}|${row.userId}`)) {
      throw new NotAnOrganizationMemberError();
    }
    this.rows.push(row);
  }
  async find(organizationId: string, projectId: string, userId: string) {
    const row = this.rows[this.index(organizationId, projectId, userId)];
    return row ? ProjectMember.restore(row) : null;
  }
  async listPage(
    organizationId: string,
    projectId: string,
    page: PageRequest,
    roles?: ReadonlyArray<ProjectRole>,
  ) {
    const all = this.rows.filter(
      (row) =>
        row.organizationId === organizationId &&
        row.projectId === projectId &&
        (roles === undefined || roles.includes(row.role)),
    );
    const result = pageOf(all, page);
    return { ...result, items: result.items.map((row) => ProjectMember.restore(row)) };
  }
  async rolesOf(organizationId: string, projectId: string, userIds: ReadonlyArray<string>) {
    return new Map(
      this.rows
        .filter(
          (row) =>
            row.organizationId === organizationId &&
            row.projectId === projectId &&
            userIds.includes(row.userId),
        )
        .map((row) => [row.userId, row.role] as const),
    );
  }
  async listForUser(organizationId: string, userId: string) {
    return this.rows
      .filter((row) => row.organizationId === organizationId && row.userId === userId)
      .map((row) => ({ projectId: row.projectId, role: row.role }));
  }
  async listUserIds(organizationId: string, projectId: string) {
    return this.rows
      .filter((row) => row.organizationId === organizationId && row.projectId === projectId)
      .map((row) => row.userId);
  }
  async count(organizationId: string, projectId: string) {
    return (await this.listUserIds(organizationId, projectId)).length;
  }
  async save(member: ProjectMember) {
    const row = member.toSnapshot();
    const at = this.index(row.organizationId, row.projectId, row.userId);
    if (at < 0 || this.rows[at]?.version !== row.version) {
      throw new VersionConflictError('ProjectMember');
    }
    this.rows[at] = { ...row, version: row.version + 1 };
  }
  async remove(organizationId: string, projectId: string, userId: string, version: number) {
    const at = this.index(organizationId, projectId, userId);
    if (at < 0 || this.rows[at]?.version !== version) {
      throw new VersionConflictError('ProjectMember');
    }
    this.rows.splice(at, 1);
  }
  async capToViewer(organizationId: string, userId: string, now: Date) {
    requireTransaction(this.transactions, 'ProjectMemberRepository.capToViewer');
    let count = 0;
    this.rows = this.rows.map((row) => {
      if (row.organizationId !== organizationId || row.userId !== userId || row.role === 'viewer') {
        return row;
      }
      count += 1;
      return { ...row, role: 'viewer', updatedAt: now, version: row.version + 1 };
    });
    return count;
  }
  /** Simula a cascata da FK quando a membership é apagada (ADR 0015). */
  removeMembership(organizationId: string, userId: string) {
    this.organizationMembers.delete(`${organizationId}|${userId}`);
    this.rows = this.rows.filter(
      (row) => !(row.organizationId === organizationId && row.userId === userId),
    );
  }
}

export class InMemoryProjectRepository implements ProjectRepository, TransactionalStore {
  rows: ProjectSnapshot[] = [];
  workflows = new Map<string, Workflow>();
  /** Projetos travados, na ordem (os testes verificam que mutações travam). */
  readonly locks: string[] = [];

  constructor(
    private readonly transactions: FakeTransactionRunner,
    private readonly members: InMemoryProjectMemberRepository,
  ) {}

  snapshot() {
    return {
      rows: [...this.rows],
      workflows: new Map(this.workflows),
      workflowVersions: new Map(this.workflowVersions),
    };
  }
  restore(state: unknown) {
    const saved = state as {
      rows: ProjectSnapshot[];
      workflows: Map<string, Workflow>;
      workflowVersions: Map<string, number>;
    };
    this.workflowVersions = saved.workflowVersions;
    this.rows = saved.rows;
    this.workflows = saved.workflows;
  }

  private visible(row: ProjectSnapshot, viewer: ProjectViewer): VisibleProject | null {
    const participation =
      this.members.rows.find(
        (member) =>
          member.organizationId === row.organizationId &&
          member.projectId === row.id &&
          member.userId === viewer.userId,
      )?.role ?? null;
    if (!viewer.seesAll && participation === null) return null;
    return { project: Project.restore(row), participation };
  }

  async add(project: Project, workflow: Workflow) {
    requireTransaction(this.transactions, 'ProjectRepository.add');
    const row = project.toSnapshot();
    if (
      this.rows.some(
        (other) => other.organizationId === row.organizationId && other.key.value === row.key.value,
      )
    ) {
      throw new ProjectKeyTakenError();
    }
    this.rows.push(row);
    this.workflows.set(row.id, workflow);
  }
  async findVisible(
    organizationId: string,
    by: Readonly<{ projectId: string } | { key: string }>,
    viewer: ProjectViewer,
  ) {
    const row = this.rows.find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        ('projectId' in by ? candidate.id === by.projectId : candidate.key.value === by.key),
    );
    return row ? this.visible(row, viewer) : null;
  }
  async findVisibleMany(
    organizationId: string,
    projectIds: ReadonlyArray<string>,
    viewer: ProjectViewer,
  ) {
    return this.rows
      .filter((row) => row.organizationId === organizationId && projectIds.includes(row.id))
      .flatMap((row) => {
        const visible = this.visible(row, viewer);
        return visible ? [visible] : [];
      });
  }
  async listVisiblePage(
    organizationId: string,
    filter: Readonly<{ viewer: ProjectViewer; archived: boolean }>,
    page: PageRequest,
  ) {
    const all = this.rows
      .filter(
        (row) =>
          row.organizationId === organizationId && (row.archivedAt !== null) === filter.archived,
      )
      .sort((a, b) => a.name.value.localeCompare(b.name.value) || a.id.localeCompare(b.id))
      .flatMap((row) => {
        const visible = this.visible(row, filter.viewer);
        return visible ? [visible] : [];
      });
    return pageOf(all, page);
  }
  async countInOrganization(organizationId: string) {
    return this.rows.filter((row) => row.organizationId === organizationId).length;
  }
  /** Travas para compartilhamento pedidas (spec 004). */
  readonly shareLocks: string[] = [];
  async lockForShare(
    organizationId: string,
    by: Readonly<{ projectId: string } | { key: string }>,
  ) {
    requireTransaction(this.transactions, 'ProjectRepository.lockForShare');
    const row = this.rows.find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        ('projectId' in by ? candidate.id === by.projectId : candidate.key.value === by.key),
    );
    if (row) this.shareLocks.push(row.id);
    return row ? Project.restore(row) : null;
  }
  async lockForUpdate(organizationId: string, projectId: string) {
    requireTransaction(this.transactions, 'ProjectRepository.lockForUpdate');
    this.locks.push(projectId);
    const row = this.rows.find(
      (candidate) => candidate.organizationId === organizationId && candidate.id === projectId,
    );
    return row ? Project.restore(row) : null;
  }
  async save(project: Project) {
    const row = project.toSnapshot();
    const at = this.rows.findIndex(
      (candidate) => candidate.organizationId === row.organizationId && candidate.id === row.id,
    );
    if (at < 0 || this.rows[at]?.version !== row.version) throw new VersionConflictError('Project');
    this.rows[at] = { ...row, version: row.version + 1 };
  }
  async findWorkflow(organizationId: string, projectId: string) {
    const owned = this.rows.some(
      (row) => row.organizationId === organizationId && row.id === projectId,
    );
    return (owned ? this.workflows.get(projectId) : undefined) ?? { statuses: [], transitions: [] };
  }
  workflowVersions = new Map<string, number>();
  async workflowVersion(organizationId: string, projectId: string) {
    const owned = this.rows.some(
      (row) => row.organizationId === organizationId && row.id === projectId,
    );
    return owned ? (this.workflowVersions.get(projectId) ?? 1) : null;
  }
  async saveWorkflow(
    organizationId: string,
    projectId: string,
    workflow: Workflow,
    expectedVersion: number,
  ) {
    requireTransaction(this.transactions, 'ProjectRepository.saveWorkflow');
    const current = await this.workflowVersion(organizationId, projectId);
    if (current !== expectedVersion) throw new VersionConflictError('Workflow');
    this.workflows.set(projectId, workflow);
    this.workflowVersions.set(projectId, expectedVersion + 1);
  }
}

/**
 * Porta `OrganizationAccess` em memória: organizações com configuração e papéis. Membros
 * adicionados aqui também valem para a FK simulada das participações (ADR 0015).
 */
export class InMemoryOrganizationAccess implements OrganizationAccess {
  readonly organizations = new Map<
    string,
    { membersCanCreateProjects: boolean; roles: Map<string, OrganizationRole> }
  >();
  /** Travas pedidas (os testes verificam que escritas travam a organização). */
  readonly shareLocks: string[] = [];

  constructor(
    private readonly transactions: FakeTransactionRunner,
    private readonly members: InMemoryProjectMemberRepository,
  ) {}

  setMember(organizationId: string, userId: string, role: OrganizationRole) {
    const organization = this.organizations.get(organizationId) ?? {
      membersCanCreateProjects: true,
      roles: new Map<string, OrganizationRole>(),
    };
    organization.roles.set(userId, role);
    this.organizations.set(organizationId, organization);
    this.members.organizationMembers.add(`${organizationId}|${userId}`);
  }

  async lockForShare(organizationId: string, userIds: ReadonlyArray<string>) {
    requireTransaction(this.transactions, 'OrganizationAccess.lockForShare');
    this.shareLocks.push(organizationId);
    const organization = this.organizations.get(organizationId);
    if (!organization) return null;
    return {
      membersCanCreateProjects: organization.membersCanCreateProjects,
      roles: await this.rolesOf(organizationId, userIds),
    };
  }
  /** Memberships travadas para compartilhamento (spec 004). */
  readonly memberShareLocks: (readonly string[])[] = [];
  async lockMembersForShare(organizationId: string, userIds: ReadonlyArray<string>) {
    requireTransaction(this.transactions, 'OrganizationAccess.lockMembersForShare');
    this.memberShareLocks.push([...userIds]);
    return this.rolesOf(organizationId, userIds);
  }
  async rolesOf(organizationId: string, userIds: ReadonlyArray<string>) {
    const roles =
      this.organizations.get(organizationId)?.roles ?? new Map<string, OrganizationRole>();
    return new Map([...roles].filter(([userId]) => userIds.includes(userId)));
  }
  async listMembersPage(
    input: Readonly<{
      organizationId: string;
      excludeUserIds: ReadonlyArray<string>;
      roles: ReadonlyArray<OrganizationRole>;
      limit: number;
      cursor: string | null;
    }>,
  ) {
    const roles =
      this.organizations.get(input.organizationId)?.roles ?? new Map<string, OrganizationRole>();
    const all = [...roles]
      .filter(
        ([userId, role]) => !input.excludeUserIds.includes(userId) && input.roles.includes(role),
      )
      .map(([userId, role]) => ({ userId, role }));
    return pageOf(all, { limit: input.limit, cursor: input.cursor });
  }
}

export class InMemoryProjectsUserDirectory implements UserDirectory {
  readonly accounts = new Map<string, ProjectUserAccount>();
  /** Lotes pedidos (uma consulta por página, sem N+1). */
  readonly queries: (readonly string[])[] = [];
  add(account: ProjectUserAccount) {
    this.accounts.set(account.id, account);
  }
  async getAccounts(userIds: ReadonlyArray<string>) {
    this.queries.push([...userIds]);
    return new Map([...this.accounts].filter(([id]) => userIds.includes(id)));
  }
}

/** Registra os avisos de "deixou de contribuir" (porta da spec 004). */
export class RecordingContributorChanges implements ProjectContributorChanges {
  readonly changes: Parameters<ProjectContributorChanges['contributorAccessReduced']>[0][] = [];
  async contributorAccessReduced(
    change: Parameters<ProjectContributorChanges['contributorAccessReduced']>[0],
  ) {
    this.changes.push(change);
  }
}

/** `tasks` vista pela porta: contagens por status e reatribuições feitas. */
export class FakeWorkflowStatusUsage implements WorkflowStatusUsage, TransactionalStore {
  counts = new Map<string, number>();
  reassignments: Array<{ projectId: string; fromStatusId: string; toStatusId: string }> = [];
  snapshot() {
    return { counts: new Map(this.counts), reassignments: [...this.reassignments] };
  }
  restore(state: unknown) {
    const saved = state as Pick<FakeWorkflowStatusUsage, 'counts' | 'reassignments'>;
    this.counts = saved.counts;
    this.reassignments = saved.reassignments;
  }
  async statusUsage() {
    return new Map(this.counts);
  }
  async reassignStatus(
    _organizationId: string,
    projectId: string,
    fromStatusId: string,
    toStatusId: string,
  ) {
    const moved = this.counts.get(fromStatusId) ?? 0;
    this.counts.delete(fromStatusId);
    this.counts.set(toStatusId, (this.counts.get(toStatusId) ?? 0) + moved);
    this.reassignments.push({ projectId, fromStatusId, toStatusId });
    return moved;
  }
}

export class RecordingProjectsSecurityEvents implements ProjectsSecurityEventRecorder {
  events: ProjectsSecurityEvent[] = [];
  record(event: ProjectsSecurityEvent) {
    this.events.push(event);
  }
}

/** Grafo de fakes para os testes de casos de uso de `projects`. */
export function createProjectsTestbed() {
  const transactions = new FakeTransactionRunner();
  const projectMembers = new InMemoryProjectMemberRepository(transactions);
  const projects = new InMemoryProjectRepository(transactions, projectMembers);
  const workflowStatusUsage = new FakeWorkflowStatusUsage();
  transactions.register(projects, projectMembers, workflowStatusUsage);
  return {
    transactions,
    projects,
    projectMembers,
    organizationAccess: new InMemoryOrganizationAccess(transactions, projectMembers),
    users: new InMemoryProjectsUserDirectory(),
    securityEvents: new RecordingProjectsSecurityEvents(),
    contributorChanges: new RecordingContributorChanges(),
    workflowStatusUsage,
    rateLimiter: new InMemoryRateLimiter(),
    clock: new FixedClock(),
    idGenerator: new SequentialIds(),
  };
}

export type ProjectsTestbed = ReturnType<typeof createProjectsTestbed>;
