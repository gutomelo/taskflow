import { computed, inject, Injectable, signal } from '@angular/core';
import type { CommentDto } from '@taskflow/contracts';
import { toApiProblem } from '../../../core/http/api-problem';
import { ActiveOrganizationStore } from '../../../core/organizations';
import { commonErrorMessage, formMessages } from '../../../shared/forms/form.messages';
import { codeMessage } from '../../organizations/organizations.messages';
import { ActiveProjectStore } from '../../projects/active-project.store';
import { CommentApi } from './comment-api';
import { commentsMessages } from './comments.messages';

type Status = 'idle' | 'loading' | 'loaded' | 'error';

/** Recusas que indicam conversa velha na tela: recarrega depois da mensagem. */
const STALE = new Set([
  'VERSION_CONFLICT',
  'CONCURRENT_UPDATE',
  'COMMENT_NOT_FOUND',
  'COMMENT_DELETED',
  'TASK_CANCELED',
  'PROJECT_ARCHIVED',
]);

/**
 * Conversa da tarefa aberta (spec 010, RF-01 a RF-07). A API devolve os mais recentes primeiro; a
 * tela mostra em ordem cronológica (mais recente embaixo) com "carregar anteriores". Sem tempo
 * real: recarrega em conflito.
 */
@Injectable()
export class CommentsStore {
  private readonly api = inject(CommentApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly project = inject(ActiveProjectStore);
  private readonly state = signal<{
    status: Status;
    taskId: string;
    items: ReadonlyArray<CommentDto>;
    olderCursor: string | null;
    count: number | null;
    canComment: boolean;
  }>({ status: 'idle', taskId: '', items: [], olderCursor: null, count: null, canComment: false });

  readonly status = computed(() => this.state().status);
  readonly items = computed(() => this.state().items);
  readonly hasOlder = computed(() => this.state().olderCursor !== null);
  readonly count = computed(() => this.state().count);
  readonly canComment = computed(() => this.state().canComment);
  readonly error = signal<string | null>(null);
  readonly announcement = signal('');
  readonly busy = signal(false);

  taskId(): string {
    return this.state().taskId;
  }

  async load(taskId: string): Promise<void> {
    this.state.update((state) => ({
      ...state,
      taskId,
      status: state.taskId === taskId && state.status === 'loaded' ? 'loaded' : 'loading',
    }));
    try {
      const page = await this.api.page(this.organization.requireId(), taskId, null);
      this.state.set({
        status: 'loaded',
        taskId,
        items: [...page.items].reverse(),
        olderCursor: page.nextCursor,
        count: page.count ?? null,
        canComment: page.actions.comment,
      });
    } catch (error) {
      if (this.project.handle(error)) return;
      this.state.update((state) => ({ ...state, status: 'error' }));
    }
  }

  async loadOlder(): Promise<void> {
    const { olderCursor, taskId } = this.state();
    if (!olderCursor) return;
    try {
      const page = await this.api.page(this.organization.requireId(), taskId, olderCursor);
      this.state.update((state) => ({
        ...state,
        items: [...[...page.items].reverse(), ...state.items],
        olderCursor: page.nextCursor,
      }));
    } catch (error) {
      if (!this.project.handle(error)) this.error.set(commentsMessages.loadFailed);
    }
  }

  create(body: string): Promise<boolean> {
    return this.run(async (organizationId) => {
      const created = await this.api.create(organizationId, this.state().taskId, body);
      this.state.update((state) => ({
        ...state,
        items: [...state.items, created],
        count: state.count === null ? null : state.count + 1,
      }));
    }, commentsMessages.sent);
  }

  edit(comment: CommentDto, body: string): Promise<boolean> {
    return this.run(async (organizationId) => {
      this.replace(await this.api.edit(organizationId, comment, body));
    }, commentsMessages.updated);
  }

  remove(comment: CommentDto): Promise<boolean> {
    return this.run(async (organizationId) => {
      await this.api.remove(organizationId, comment);
      this.replace(await this.api.get(organizationId, comment.id));
      this.state.update((state) => ({
        ...state,
        count: state.count === null ? null : Math.max(0, state.count - 1),
      }));
    }, commentsMessages.deleted);
  }

  private replace(comment: CommentDto): void {
    this.state.update((state) => ({
      ...state,
      items: state.items.map((item) => (item.id === comment.id ? comment : item)),
    }));
  }

  private async run(
    action: (organizationId: string) => Promise<void>,
    success: string,
  ): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action(this.organization.requireId());
      this.announcement.set(success);
      return true;
    } catch (error) {
      if (this.project.handle(error)) return false;
      const problem = toApiProblem(error);
      this.error.set(
        commonErrorMessage(problem) ??
          codeMessage(commentsMessages.errors, problem.code) ??
          formMessages.errors.unexpected,
      );
      if (STALE.has(problem.code ?? '')) await this.load(this.state().taskId);
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
