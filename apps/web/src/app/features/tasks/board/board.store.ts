import { computed, inject, Injectable, signal } from '@angular/core';
import type { Board, Card, MoveCardRequest } from '@taskflow/contracts';
import { toApiProblem, type ApiProblem } from '../../../core/http/api-problem';
import { ActiveOrganizationStore } from '../../../core/organizations';
import { commonErrorMessage, formMessages } from '../../../shared/forms/form.messages';
import { codeMessage } from '../../organizations/organizations.messages';
import { ActiveProjectStore } from '../../projects/active-project.store';
import { TaskApi } from '../task-api';
import { boardMessages } from '../tasks.messages';

type Status = 'loading' | 'loaded' | 'error';
type Column = Readonly<{ statusId: string; cards: ReadonlyArray<Card>; nextCursor: string | null }>;

/**
 * Códigos que mostram dados velhos (inclusive transições ou arquivamento mudados por outra
 * pessoa): o quadro é recarregado depois da mensagem.
 */
const STALE = new Set([
  'VERSION_CONFLICT',
  'TRANSITION_NOT_ALLOWED',
  'PROJECT_ARCHIVED',
  'CONCURRENT_UPDATE',
  'INVALID_POSITION',
  'STATUS_NOT_FOUND',
  'TASK_NOT_FOUND',
  'TASK_CANCELED',
]);

/**
 * Quadro do projeto aberto (spec 005, RF-01 a RF-04). Movimento otimista: o card muda de lugar na
 * hora e volta ao lugar anterior se a API recusar (a API sempre decide). Sem tempo real
 * (decisão 5): recarrega depois de conflitos e em "Atualizar".
 */
@Injectable()
export class BoardStore {
  private readonly api = inject(TaskApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly project = inject(ActiveProjectStore);
  private readonly state = signal<{
    status: Status;
    board: Board | null;
    columns: ReadonlyArray<Column>;
  }>({ status: 'loading', board: null, columns: [] });

  readonly status = computed(() => this.state().status);
  readonly statuses = computed(() => this.state().board?.statuses ?? []);
  readonly columns = computed(() => this.state().columns);
  readonly canMove = computed(() => this.state().board?.actions.move ?? false);
  readonly error = signal<string | null>(null);
  readonly announcement = signal('');
  readonly moving = signal(false);

  statusName(statusId: string): string {
    return this.statuses().find((status) => status.id === statusId)?.name ?? '';
  }

  /** Colunas para onde um card da coluna `statusId` pode ir (transições do workflow). */
  targetsFrom(statusId: string): ReadonlyArray<string> {
    return (this.state().board?.transitions ?? [])
      .filter((transition) => transition.fromStatusId === statusId)
      .map((transition) => transition.toStatusId);
  }

  /** "Atualizar": a mensagem da última recusa deixa de valer. */
  refresh(): Promise<void> {
    this.error.set(null);
    return this.load();
  }

  async load(): Promise<void> {
    this.state.update((state) => ({ ...state, status: state.board ? state.status : 'loading' }));
    try {
      const board = await this.api.board(this.organization.requireId(), this.project.requireId());
      this.state.set({
        status: 'loaded',
        board,
        columns: board.columns.map((column) => ({ ...column })),
      });
    } catch (error) {
      if (this.project.handle(error)) return;
      this.state.update((state) => ({ ...state, status: 'error' }));
    }
  }

  async loadMore(statusId: string): Promise<void> {
    const column = this.columns().find((entry) => entry.statusId === statusId);
    if (!column?.nextCursor) return;
    try {
      const page = await this.api.column(
        this.organization.requireId(),
        this.project.requireId(),
        statusId,
        column.nextCursor,
      );
      this.replaceColumn(statusId, (current) => ({
        statusId,
        cards: [...current.cards, ...page.cards],
        nextCursor: page.nextCursor,
      }));
    } catch (error) {
      if (!this.project.handle(error)) this.error.set(boardMessages.loadFailed);
    }
  }

  /**
   * Move o card para `index` da coluna `toStatusId` (posição na lista já sem o card). O vizinho
   * vai para a API (`afterTaskId`/`beforeTaskId`); a chave é calculada no servidor.
   */
  async move(card: Card, toStatusId: string, index: number): Promise<boolean> {
    if (this.moving()) return false;
    const before = this.state().columns;
    const target = before
      .find((column) => column.statusId === toStatusId)
      ?.cards.filter((item) => item.id !== card.id);
    if (!target) return false;
    const position = Math.max(0, Math.min(index, target.length));
    const request: MoveCardRequest = {
      toStatusId,
      version: card.version,
      ...(position > 0
        ? { afterTaskId: target[position - 1]?.id ?? '' }
        : target[0]
          ? { beforeTaskId: target[0].id }
          : {}),
    };
    // Otimista: tira da coluna de origem e põe na posição pedida.
    this.state.update((state) => ({
      ...state,
      columns: state.columns.map((column) => {
        const cards = column.cards.filter((item) => item.id !== card.id);
        if (column.statusId !== toStatusId) return { ...column, cards };
        return { ...column, cards: [...cards.slice(0, position), card, ...cards.slice(position)] };
      }),
    }));
    this.moving.set(true);
    this.error.set(null);
    try {
      const moved = await this.api.moveCard(this.organization.requireId(), card.id, request);
      this.replaceColumn(toStatusId, (column) => ({
        ...column,
        cards: column.cards.map((item) => (item.id === card.id ? moved.card : item)),
      }));
      this.announcement.set(
        card.status.id === toStatusId
          ? boardMessages.reordered(card.key, position + 1)
          : boardMessages.moved(card.key, this.statusName(toStatusId)),
      );
      return true;
    } catch (error) {
      // Reversão: o card volta exatamente para onde estava.
      this.state.update((state) => ({ ...state, columns: before }));
      if (this.project.handle(error)) return false;
      const problem = toApiProblem(error);
      this.error.set(this.messageFor(problem));
      if (STALE.has(problem.code ?? '')) await this.load();
      return false;
    } finally {
      this.moving.set(false);
    }
  }

  private replaceColumn(statusId: string, update: (column: Column) => Column): void {
    this.state.update((state) => ({
      ...state,
      columns: state.columns.map((column) =>
        column.statusId === statusId ? update(column) : column,
      ),
    }));
  }

  /** 422 de BR-001/BR-006: subtarefas não são cards; bloqueadoras viram chaves se estão no quadro. */
  private messageFor(problem: ApiProblem): string {
    if (problem.code === 'TASK_HAS_PENDING_REQUIRED_SUBTASKS') return boardMessages.pendingSubtasks;
    if (problem.code === 'TASK_BLOCKED_BY_DEPENDENCIES') {
      const cards = this.columns().flatMap((column) => column.cards);
      const keys = problem.taskIds.flatMap((id) => cards.find((card) => card.id === id)?.key ?? []);
      return keys.length === problem.taskIds.length && keys.length > 0
        ? boardMessages.pendingBlockers(keys.join(', '))
        : boardMessages.pendingBlockersCount(problem.taskIds.length);
    }
    return (
      commonErrorMessage(problem) ??
      codeMessage(boardMessages.errors, problem.code) ??
      formMessages.errors.unexpected
    );
  }
}
