import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { Card } from '@taskflow/contracts';
import { boardMessages, PRIORITY_LABELS, taskListMessages } from '../tasks.messages';

export type CardMove = Readonly<{ toStatusId: string; index: number }>;

/**
 * Card do quadro. Alternativa ao arrastar (WCAG 2.2, 2.5.7): "Mover KEY" abre ações por teclado —
 * para cima, para baixo e para cada coluna permitida pelo fluxo.
 */
@Component({
  selector: 'tf-board-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <article
      class="rounded-md border border-border bg-surface p-3 text-sm"
      [attr.data-card-id]="card().id"
    >
      <a
        [routerLink]="['..', 'tasks', String(card().number)]"
        class="block hover:underline focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span class="font-mono text-xs text-muted">{{ card().key }}</span>
        <span class="mt-1 block font-medium">{{ card().title }}</span>
      </a>
      <p class="mt-2 flex flex-wrap gap-2 text-xs text-muted">
        <span>{{ priorities[card().priority] }}</span>
        <span>{{
          card().assignee ? (card().assignee?.name ?? list.noName) : list.unassigned
        }}</span>
        @if (card().dueDate) {
          <span>{{ list.dueDate(card().dueDate ?? '') }}</span>
        }
        @if (card().subtasks.total > 0) {
          <span>{{ m.subtasks(card().subtasks.done, card().subtasks.total) }}</span>
        }
      </p>
      @if (canMove()) {
        <button
          type="button"
          class="mt-2 text-xs underline focus-visible:outline-2 focus-visible:outline-focus"
          [attr.aria-expanded]="open()"
          (click)="open.set(!open())"
        >
          {{ m.actionsFor(card().key) }}
        </button>
        @if (open()) {
          <ul class="mt-1 flex flex-wrap gap-1" [attr.aria-label]="m.actionsFor(card().key)">
            @if (index() > 0) {
              <li>
                <button
                  type="button"
                  class="rounded border border-border px-2 py-0.5 text-xs"
                  (click)="emit(statusId(), index() - 1)"
                >
                  {{ m.up }}
                </button>
              </li>
            }
            @if (index() < columnSize() - 1) {
              <li>
                <button
                  type="button"
                  class="rounded border border-border px-2 py-0.5 text-xs"
                  (click)="emit(statusId(), index() + 1)"
                >
                  {{ m.down }}
                </button>
              </li>
            }
            @for (target of targets(); track target.id) {
              <li>
                <button
                  type="button"
                  class="rounded border border-border px-2 py-0.5 text-xs"
                  (click)="emit(target.id, target.size)"
                >
                  {{ m.moveTo(target.name) }}
                </button>
              </li>
            }
          </ul>
        }
      }
    </article>
  `,
})
export class BoardCard {
  protected readonly m = boardMessages;
  protected readonly list = taskListMessages;
  protected readonly priorities = PRIORITY_LABELS;
  protected readonly String = String;

  readonly card = input.required<Card>();
  readonly statusId = input.required<string>();
  readonly index = input.required<number>();
  readonly columnSize = input.required<number>();
  /** Colunas permitidas pelo fluxo (com o tamanho atual: o card vai para o fim). */
  readonly targets = input<ReadonlyArray<Readonly<{ id: string; name: string; size: number }>>>([]);
  readonly canMove = input(false);
  readonly moved = output<CardMove>();
  protected readonly open = signal(false);

  protected emit(toStatusId: string, index: number): void {
    this.open.set(false);
    this.moved.emit({ toStatusId, index });
  }
}
