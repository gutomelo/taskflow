import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import type { TaskPriority, TaskSummary, WorkflowDto } from '@taskflow/contracts';
import { ActiveOrganizationStore } from '../../core/organizations';
import { ActiveProjectStore } from '../projects/active-project.store';
import { ProjectApi } from '../projects/project-api';
import { CreateTaskForm } from './create-task-form';
import { TASK_DELETED_STATE } from './task-detail.store';
import { TaskApi, type TaskFilters } from './task-api';
import { isTaskPriority } from './tasks-contract-guards';
import {
  createTaskMessages,
  PRIORITY_LABELS,
  taskDetailMessages,
  taskListMessages,
} from './tasks.messages';

type Status = 'loading' | 'loaded' | 'error';

const NO_FILTERS: TaskFilters = { statusId: null, assigned: null, priority: null, canceled: false };

/** Aba "Tarefas" do projeto (RF-03, RF-13): lista com filtros, paginação e "Nova tarefa". */
@Component({
  selector: 'tf-project-tasks-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CreateTaskForm, MatButton, RouterLink],
  template: `
    <section class="mx-auto max-w-3xl px-4 py-6" aria-labelledby="tasks-title">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <h2 id="tasks-title" class="text-lg font-semibold">{{ m.title }}</h2>
        @if (project.can('task:create') && !creating()) {
          <button mat-flat-button type="button" (click)="creating.set(true)">{{ m.create }}</button>
        }
      </div>

      <p class="sr-only" role="status" aria-live="polite">{{ announcement() }}</p>

      @if (creating()) {
        <div class="mt-4">
          <tf-create-task-form
            [projectId]="projectId"
            (created)="created($event)"
            (canceled)="creating.set(false)"
            (failed)="project.handle($event)"
          />
        </div>
      }

      <div
        class="mt-4 flex flex-wrap items-end gap-3"
        role="group"
        [attr.aria-label]="m.filtersLabel"
      >
        <label class="flex flex-col gap-1 text-sm">
          {{ m.status }}
          <select
            class="rounded-md border border-border bg-surface px-2 py-1"
            (change)="filter({ statusId: value($event) || null })"
          >
            <option value="">{{ m.allStatuses }}</option>
            @for (status of statuses(); track status.id) {
              <option [value]="status.id">{{ status.name }}</option>
            }
          </select>
        </label>
        <label class="flex flex-col gap-1 text-sm">
          {{ m.assigned }}
          <select
            class="rounded-md border border-border bg-surface px-2 py-1"
            (change)="filter({ assigned: assignedFrom($event) })"
          >
            <option value="">{{ m.anyone }}</option>
            <option value="me">{{ m.me }}</option>
            <option value="none">{{ m.nobody }}</option>
          </select>
        </label>
        <label class="flex flex-col gap-1 text-sm">
          {{ m.priority }}
          <select
            class="rounded-md border border-border bg-surface px-2 py-1"
            (change)="filter({ priority: priorityFrom($event) })"
          >
            <option value="">{{ m.anyPriority }}</option>
            @for (priority of priorities; track priority) {
              <option [value]="priority">{{ labels[priority] }}</option>
            }
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" (change)="filter({ canceled: checked($event) })" />
          {{ m.includeCanceled }}
        </label>
      </div>

      @switch (status()) {
        @case ('loading') {
          <div class="mt-6 space-y-2" aria-hidden="true">
            @for (row of [1, 2, 3]; track row) {
              <div class="h-14 animate-pulse rounded-md bg-surface-muted"></div>
            }
          </div>
          <p class="sr-only" role="status">{{ m.loading }}</p>
        }
        @case ('error') {
          <div class="mt-6" role="alert">
            <p class="text-sm text-error-text">{{ m.loadFailed }}</p>
            <button matButton="outlined" type="button" class="mt-2" (click)="load()">
              {{ m.retry }}
            </button>
          </div>
        }
        @default {
          @if (items().length === 0) {
            <p class="mt-6 text-sm text-muted">{{ filtered() ? m.emptyFiltered : m.empty }}</p>
          } @else {
            <ul
              class="mt-6 divide-y divide-border rounded-md border border-border"
              [attr.aria-label]="m.listLabel"
            >
              @for (task of items(); track task.id) {
                <li>
                  <a
                    [routerLink]="[String(task.number)]"
                    class="flex flex-col gap-1 px-4 py-3 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <span class="flex flex-wrap items-center gap-2">
                      <span class="font-mono text-xs text-muted">{{ task.key }}</span>
                      <span class="font-medium" [class.line-through]="task.canceledAt">{{
                        task.title
                      }}</span>
                      @if (task.canceledAt) {
                        <span class="rounded bg-surface-muted px-2 py-0.5 text-xs">{{
                          m.canceledBadge
                        }}</span>
                      }
                    </span>
                    <span class="flex flex-wrap gap-3 text-xs text-muted">
                      <span>{{ task.status.name }}</span>
                      <span>{{ labels[task.priority] }}</span>
                      <span>{{ assigneeLabel(task) }}</span>
                      @if (task.dueDate) {
                        <span>{{ m.dueDate(task.dueDate) }}</span>
                      }
                    </span>
                  </a>
                </li>
              }
            </ul>
            @if (nextCursor()) {
              <button
                matButton="outlined"
                type="button"
                class="mt-4"
                [disabled]="loadingMore()"
                (click)="loadMore()"
              >
                {{ m.loadMore }}
              </button>
            }
          }
        }
      }
    </section>
  `,
})
export class ProjectTasksPage {
  private readonly api = inject(TaskApi);
  private readonly projects = inject(ProjectApi);
  private readonly organization = inject(ActiveOrganizationStore);
  protected readonly project = inject(ActiveProjectStore);
  protected readonly m = taskListMessages;
  protected readonly labels = PRIORITY_LABELS;
  protected readonly priorities = Object.keys(PRIORITY_LABELS) as ReadonlyArray<TaskPriority>;
  protected readonly String = String;
  protected readonly projectId = this.project.requireId();

  protected readonly status = signal<Status>('loading');
  protected readonly items = signal<ReadonlyArray<TaskSummary>>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly creating = signal(false);
  /** Vindo do detalhe depois de excluir: anuncia a chave excluída. */
  private readonly deletedKey: unknown =
    inject(Router).currentNavigation()?.extras.state?.[TASK_DELETED_STATE];
  protected readonly announcement = signal(
    typeof this.deletedKey === 'string' ? taskDetailMessages.deleted(this.deletedKey) : '',
  );
  protected readonly filters = signal<TaskFilters>(NO_FILTERS);
  private readonly workflow = signal<WorkflowDto | null>(null);
  protected readonly statuses = computed(() => this.workflow()?.statuses ?? []);
  protected readonly filtered = computed(() => {
    const { statusId, assigned, priority, canceled } = this.filters();
    return statusId !== null || assigned !== null || priority !== null || canceled;
  });
  /** Descarta respostas de filtros anteriores (troca rápida). */
  private generation = 0;

  constructor() {
    void this.load();
    void this.loadWorkflow();
  }

  protected filter(change: Partial<TaskFilters>): void {
    this.filters.update((filters) => ({ ...filters, ...change }));
    void this.load();
  }

  protected value(event: Event): string {
    return event.target instanceof HTMLSelectElement ? event.target.value : '';
  }
  protected checked(event: Event): boolean {
    return event.target instanceof HTMLInputElement && event.target.checked;
  }
  protected assignedFrom(event: Event): TaskFilters['assigned'] {
    const value = this.value(event);
    return value === 'me' || value === 'none' ? value : null;
  }
  protected priorityFrom(event: Event): TaskPriority | null {
    const value = this.value(event);
    return isTaskPriority(value) ? value : null;
  }

  protected assigneeLabel(task: TaskSummary): string {
    if (!task.assignee) return this.m.unassigned;
    return this.m.assignee(task.assignee.name ?? this.m.noName);
  }

  protected created(task: { key: string } & TaskSummary): void {
    this.creating.set(false);
    this.announcement.set(createTaskMessages.created(task.key));
    void this.load();
  }

  protected async load(): Promise<void> {
    const generation = (this.generation += 1);
    this.status.set('loading');
    try {
      const page = await this.api.list(
        this.organization.requireId(),
        this.projectId,
        this.filters(),
        null,
      );
      if (generation !== this.generation) return;
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.status.set('loaded');
    } catch (error) {
      if (this.project.handle(error)) return;
      if (generation === this.generation) this.status.set('error');
    }
  }

  /** Uma página por vez: clique duplo não busca o mesmo cursor duas vezes. */
  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    const generation = this.generation;
    this.loadingMore.set(true);
    try {
      const page = await this.api.list(
        this.organization.requireId(),
        this.projectId,
        this.filters(),
        cursor,
      );
      if (generation !== this.generation) return;
      this.items.update((items) => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      if (this.project.handle(error)) return;
      if (generation === this.generation) this.status.set('error');
    } finally {
      this.loadingMore.set(false);
    }
  }

  /** Só para o filtro de status: sem o fluxo, a lista funciona com "Todos os status". */
  private async loadWorkflow(): Promise<void> {
    try {
      this.workflow.set(
        await this.projects.workflow(this.organization.requireId(), this.projectId),
      );
    } catch (error) {
      this.project.handle(error);
    }
  }
}
