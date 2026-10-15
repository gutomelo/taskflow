import { CdkDrag, CdkDropList, CdkDropListGroup, type CdkDragDrop } from '@angular/cdk/drag-drop';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import type { Card } from '@taskflow/contracts';
import { boardMessages } from '../tasks.messages';
import { BoardCard, type CardMove } from './board-card';
import { BoardStore } from './board.store';

/** Aba "Quadro" (spec 005, RF-12): colunas = status do fluxo; arrastar e soltar ou teclado. */
@Component({
  selector: 'tf-board-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BoardCard, CdkDrag, CdkDropList, CdkDropListGroup, MatButton],
  providers: [BoardStore],
  template: `
    <section class="px-4 py-6" aria-labelledby="board-title">
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <h2 id="board-title" class="text-lg font-semibold">{{ m.title }}</h2>
        <button matButton="outlined" type="button" (click)="store.refresh()">
          {{ m.refresh }}
        </button>
      </div>
      <p class="sr-only" role="status" aria-live="polite">{{ store.announcement() }}</p>
      @if (store.error(); as message) {
        <p
          class="mx-auto mt-4 max-w-6xl rounded-md bg-surface-muted px-4 py-3 text-sm text-error-text"
          role="alert"
        >
          {{ message }}
        </p>
      }
      @switch (store.status()) {
        @case ('loading') {
          <div class="mt-6 flex gap-4" aria-hidden="true">
            @for (column of [1, 2, 3]; track column) {
              <div class="h-64 w-72 shrink-0 animate-pulse rounded-md bg-surface-muted"></div>
            }
          </div>
          <p class="sr-only" role="status">{{ m.loading }}</p>
        }
        @case ('error') {
          <div class="mx-auto mt-6 max-w-6xl" role="alert">
            <p class="text-sm text-error-text">{{ m.loadFailed }}</p>
            <button matButton="outlined" type="button" class="mt-2" (click)="store.refresh()">
              {{ m.retry }}
            </button>
          </div>
        }
        @default {
          <div class="mt-6 flex gap-4 overflow-x-auto pb-4" cdkDropListGroup>
            @for (column of store.columns(); track column.statusId) {
              <section
                class="flex w-72 shrink-0 flex-col rounded-md bg-surface-muted p-3"
                [attr.aria-label]="
                  m.columnLabel(store.statusName(column.statusId), column.cards.length)
                "
              >
                <h3 class="text-sm font-semibold">{{ store.statusName(column.statusId) }}</h3>
                @if (store.targetsFrom(column.statusId).length === 0) {
                  <p class="mt-1 text-xs text-muted">{{ m.noExit }}</p>
                }
                <ul
                  class="mt-2 flex min-h-12 flex-col gap-2"
                  cdkDropList
                  [cdkDropListData]="column.statusId"
                  [cdkDropListEnterPredicate]="canEnter"
                  (cdkDropListDropped)="dropped($event)"
                >
                  @for (card of column.cards; track card.id; let index = $index) {
                    <li
                      cdkDrag
                      [cdkDragData]="card"
                      [cdkDragDisabled]="!store.canMove() || store.moving()"
                    >
                      <tf-board-card
                        [card]="card"
                        [statusId]="column.statusId"
                        [index]="index"
                        [columnSize]="column.cards.length"
                        [targets]="targetsFor(column.statusId)"
                        [canMove]="store.canMove()"
                        (moved)="move(card, $event)"
                      />
                    </li>
                  } @empty {
                    <li class="text-xs text-muted">{{ m.emptyColumn }}</li>
                  }
                </ul>
                @if (column.nextCursor) {
                  <button
                    matButton
                    type="button"
                    class="mt-2"
                    (click)="store.loadMore(column.statusId)"
                  >
                    {{ m.loadMore }}
                  </button>
                }
              </section>
            }
          </div>
        }
      }
    </section>
  `,
})
export class BoardPage {
  protected readonly store = inject(BoardStore);
  protected readonly m = boardMessages;
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);

  constructor() {
    void this.store.load();
  }

  /** Só colunas permitidas pelo fluxo (ou a própria coluna, para reordenar). A API decide. */
  protected readonly canEnter = (drag: CdkDrag<Card>, drop: CdkDropList<string>): boolean =>
    drop.data === drag.data.status.id ||
    this.store.targetsFrom(drag.data.status.id).includes(drop.data);

  protected targetsFor(statusId: string) {
    return this.store.targetsFrom(statusId).map((id) => ({
      id,
      name: this.store.statusName(id),
      size: this.store.columns().find((column) => column.statusId === id)?.cards.length ?? 0,
    }));
  }

  protected dropped(event: CdkDragDrop<string, string, Card>): void {
    if (event.previousContainer === event.container && event.previousIndex === event.currentIndex)
      return;
    void this.move(event.item.data, {
      toStatusId: event.container.data,
      index: event.currentIndex,
    });
  }

  protected async move(card: Card, move: CardMove): Promise<void> {
    await this.store.move(card, move.toStatusId, move.index);
    // Foco de volta ao card (onde ele estiver depois do movimento ou da reversão).
    afterNextRender(
      () => {
        const element: HTMLElement = this.host.nativeElement;
        element.querySelector<HTMLElement>(`[data-card-id="${card.id}"] a`)?.focus();
      },
      { injector: this.injector },
    );
  }
}
