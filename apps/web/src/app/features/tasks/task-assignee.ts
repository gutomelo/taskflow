import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import type { AssignableUser } from '@taskflow/contracts';
import { ActiveOrganizationStore } from '../../core/organizations';
import { ActiveProjectStore } from '../projects/active-project.store';
import { TaskApi } from './task-api';
import { TaskDetailStore } from './task-detail.store';
import { taskDetailMessages } from './tasks.messages';

/** Responsável (RF-06, BR-003): só entre quem a API lista como elegível (manager/member). */
@Component({
  selector: 'tf-task-assignee',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
  template: `
    @if (store.task(); as task) {
      <section class="mt-6" aria-labelledby="assignee-title">
        <h3 id="assignee-title" class="text-sm font-semibold">{{ m.assignee }}</h3>
        @if (task.actions.assign) {
          <div class="mt-2 flex flex-wrap items-end gap-2">
            <label class="flex flex-col gap-1 text-sm">
              <span class="sr-only">{{ m.assignee }}</span>
              <select
                class="rounded-md border border-border bg-surface px-2 py-1"
                (change)="pick($event)"
              >
                <option value="" [selected]="chosen() === null">{{ m.nobody }}</option>
                @if (task.assignee && !listed(task.assignee.userId)) {
                  <option [value]="task.assignee.userId" selected>
                    {{ task.assignee.name ?? m.noName }}
                  </option>
                }
                @for (person of candidates(); track person.userId) {
                  <option [value]="person.userId" [selected]="chosen() === person.userId">
                    {{ person.name ?? m.noName }}
                  </option>
                }
              </select>
            </label>
            <button
              matButton="outlined"
              type="button"
              [disabled]="store.busy() || chosen() === (task.assignee?.userId ?? null)"
              (click)="save()"
            >
              {{ m.saveAssignee }}
            </button>
            @if (nextCursor()) {
              <button matButton type="button" (click)="loadCandidates()">
                {{ m.moreCandidates }}
              </button>
            }
          </div>
        } @else {
          <p class="mt-1 text-sm">
            {{ task.assignee ? (task.assignee.name ?? m.noName) : m.nobody }}
          </p>
        }
      </section>
    }
  `,
})
export class TaskAssignee {
  private readonly api = inject(TaskApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly project = inject(ActiveProjectStore);
  protected readonly store = inject(TaskDetailStore);
  protected readonly m = taskDetailMessages;
  protected readonly candidates = signal<ReadonlyArray<AssignableUser>>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly chosen = signal<string | null>(this.store.task()?.assignee?.userId ?? null);
  private loadingCandidates = false;

  constructor() {
    if (this.store.task()?.actions.assign) void this.loadCandidates();
  }

  protected listed(userId: string): boolean {
    return this.candidates().some((person) => person.userId === userId);
  }

  protected pick(event: Event): void {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
    this.chosen.set(value === '' ? null : value);
  }

  protected async save(): Promise<void> {
    const target = this.chosen();
    await this.store.run(
      (organizationId, task) => this.api.assign(organizationId, task, target),
      this.m.assigneeSaved,
    );
    this.chosen.set(this.store.task()?.assignee?.userId ?? null);
  }

  /** Uma página por vez; a primeira com a tarefa aberta. */
  protected async loadCandidates(): Promise<void> {
    if (this.loadingCandidates) return;
    this.loadingCandidates = true;
    try {
      const page = await this.api.assignableUsers(
        this.organization.requireId(),
        this.project.requireId(),
        this.nextCursor(),
      );
      this.candidates.update((items) => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      // Sem candidatos, o seletor mostra só "Sem responsável" e o atual; 404 volta à lista.
      this.project.handle(error);
    } finally {
      this.loadingCandidates = false;
    }
  }
}
