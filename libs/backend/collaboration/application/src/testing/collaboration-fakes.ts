// Fakes em memória para os testes de casos de uso de `collaboration`. Nunca em produção.
import {
  Comment,
  type CommentPosition,
  type CommentRepository,
  type CommentSnapshot,
} from '@taskflow/backend/collaboration/domain';
import {
  FakeTransactionRunner,
  FixedClock,
  InMemoryRateLimiter,
  SequentialIds,
  type TransactionalStore,
} from '@taskflow/backend/shared/application/testing';
import {
  VersionConflictError,
  type OrganizationRole,
  type ProjectRole,
} from '@taskflow/backend/shared/kernel';
import type {
  DiscussionLock,
  DiscussionTask,
  MentionCandidate,
  MentionCandidatePage,
  TaskDiscussionAccess,
} from '../lib/ports/task-discussion-access';
import type { CollaborationUserDirectory } from '../lib/ports/user-directory';
import type {
  CollaborationEvent,
  CollaborationEventRecorder,
} from '../lib/shared/collaboration-events';

function requireTransaction(transactions: FakeTransactionRunner, operation: string): void {
  if (!transactions.inTransaction) throw new Error(`${operation} requires a transaction`);
}

export class InMemoryCommentRepository implements CommentRepository, TransactionalStore {
  rows: CommentSnapshot[] = [];
  readonly locks: string[] = [];

  constructor(private readonly transactions: FakeTransactionRunner) {}

  snapshot() {
    return [...this.rows];
  }
  restore(state: unknown) {
    // Cópia feita por `snapshot()` deste mesmo repositório.
    this.rows = state as CommentSnapshot[];
  }

  async add(comment: Comment) {
    this.rows.push(comment.snapshot());
  }
  async findById(organizationId: string, commentId: string) {
    const row = this.rows.find(
      (candidate) => candidate.organizationId === organizationId && candidate.id === commentId,
    );
    return row ? Comment.restore(row) : null;
  }
  async lockById(organizationId: string, commentId: string) {
    requireTransaction(this.transactions, 'CommentRepository.lockById');
    this.locks.push(commentId);
    return this.findById(organizationId, commentId);
  }
  async save(comment: Comment) {
    const next = comment.snapshot();
    const index = this.rows.findIndex(
      (row) =>
        row.organizationId === next.organizationId &&
        row.id === next.id &&
        row.version === next.version,
    );
    if (index < 0) throw new VersionConflictError('Comment');
    this.rows[index] = { ...next, version: next.version + 1 };
  }
  async page(organizationId: string, taskId: string, limit: number, after: CommentPosition | null) {
    const later = (a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) =>
      a.createdAt.getTime() === b.createdAt.getTime() ? a.id > b.id : a.createdAt > b.createdAt;
    return this.rows
      .filter((row) => row.organizationId === organizationId && row.taskId === taskId)
      .filter((row) => !after || later(after, row))
      .sort((a, b) => (later(a, b) ? -1 : 1))
      .slice(0, limit)
      .map((row) => Comment.restore(row));
  }
  async countActive(organizationId: string, taskId: string) {
    return this.rows.filter(
      (row) =>
        row.organizationId === organizationId && row.taskId === taskId && row.deletedAt === null,
    ).length;
  }
}

export type FakeTask = {
  organizationId: string;
  projectId: string;
  taskId: string;
  archived: boolean;
  canceled: boolean;
};

/** Tarefas, papéis efetivos por projeto e candidatos (nome e e-mail) da porta `TaskDiscussionAccess`. */
export class FakeTaskDiscussionAccess implements TaskDiscussionAccess {
  readonly tasks: FakeTask[] = [];
  /** `org|project|user` → papel efetivo (ausente = não lê). */
  readonly roles = new Map<string, ProjectRole>();
  readonly people = new Map<string, Readonly<{ name: string; email: string }>>();
  readonly locks: Array<Readonly<{ taskId: string; userIds: ReadonlyArray<string> }>> = [];
  readonly searches: Array<
    Readonly<{ projectId: string; query: string; excludeUserId: string; cursor: string | null }>
  > = [];
  tooManyReaders = false;

  constructor(private readonly transactions: FakeTransactionRunner) {}

  addTask(task: FakeTask): FakeTask {
    this.tasks.push(task);
    return task;
  }
  setRole(organizationId: string, projectId: string, userId: string, role: ProjectRole | null) {
    const key = `${organizationId}|${projectId}|${userId}`;
    if (role === null) this.roles.delete(key);
    else this.roles.set(key, role);
  }
  private roleOf(task: FakeTask, userId: string): ProjectRole | null {
    return this.roles.get(`${task.organizationId}|${task.projectId}|${userId}`) ?? null;
  }
  private find(organizationId: string, taskId: string) {
    return this.tasks.find(
      (task) => task.organizationId === organizationId && task.taskId === taskId,
    );
  }

  async lockForComment(
    organizationId: string,
    taskId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<DiscussionLock | null> {
    requireTransaction(this.transactions, 'TaskDiscussionAccess.lockForComment');
    const task = this.find(organizationId, taskId);
    if (!task) return null;
    this.locks.push({ taskId, userIds });
    return {
      taskId,
      projectId: task.projectId,
      archived: task.archived,
      canceled: task.canceled,
      effectiveRoles: new Map(userIds.map((userId) => [userId, this.roleOf(task, userId)])),
    };
  }
  async resolveForRead(
    organizationId: string,
    taskId: string,
    viewer: Readonly<{ userId: string; organizationRole: OrganizationRole }>,
  ): Promise<DiscussionTask | null> {
    const task = this.find(organizationId, taskId);
    const role = task ? this.roleOf(task, viewer.userId) : null;
    if (!task || !role) return null;
    return {
      taskId,
      projectId: task.projectId,
      archived: task.archived,
      canceled: task.canceled,
      effectiveRole: role,
    };
  }
  async mentionCandidates(
    organizationId: string,
    projectId: string,
    search: Readonly<{
      query: string;
      excludeUserId: string;
      limit: number;
      cursor: string | null;
    }>,
  ): Promise<MentionCandidatePage | null> {
    this.searches.push({
      projectId,
      query: search.query,
      excludeUserId: search.excludeUserId,
      cursor: search.cursor,
    });
    if (this.tooManyReaders) return null;
    const needle = search.query.toLowerCase();
    const readers: MentionCandidate[] = [...this.roles.keys()]
      .filter((key) => key.startsWith(`${organizationId}|${projectId}|`))
      .map((key) => key.split('|')[2] ?? '')
      .filter((userId) => userId !== search.excludeUserId)
      .flatMap((userId) => {
        const person = this.people.get(userId);
        return person ? [{ userId, ...person }] : [];
      })
      .filter(
        (person) =>
          person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle),
      )
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    const start = search.cursor ? Number(search.cursor) : 0;
    const items = readers.slice(start, start + search.limit);
    return {
      items,
      nextCursor: start + search.limit < readers.length ? String(start + search.limit) : null,
    };
  }
}

/** Nomes só de quem ainda é membro da organização (`org|user` em `members`). */
export class InMemoryCollaborationUserDirectory implements CollaborationUserDirectory {
  readonly names = new Map<string, string>();
  readonly members = new Set<string>();
  calls = 0;

  async displayNames(organizationId: string, userIds: ReadonlyArray<string>) {
    this.calls += 1;
    return new Map(
      userIds.flatMap((userId) => {
        const name = this.names.get(userId);
        return name && this.members.has(`${organizationId}|${userId}`)
          ? [[userId, name] as const]
          : [];
      }),
    );
  }
}

export class RecordingCollaborationEvents implements CollaborationEventRecorder {
  readonly events: CollaborationEvent[] = [];
  record(event: CollaborationEvent) {
    this.events.push(event);
  }
  types() {
    return this.events.map((event) => event.type);
  }
}

export function createCollaborationTestbed() {
  const transactions = new FakeTransactionRunner();
  const comments = new InMemoryCommentRepository(transactions);
  transactions.register(comments);
  return {
    transactions,
    comments,
    discussion: new FakeTaskDiscussionAccess(transactions),
    users: new InMemoryCollaborationUserDirectory(),
    events: new RecordingCollaborationEvents(),
    rateLimiter: new InMemoryRateLimiter(),
    clock: new FixedClock(),
    idGenerator: new SequentialIds(),
  };
}

export type CollaborationTestbed = ReturnType<typeof createCollaborationTestbed>;
