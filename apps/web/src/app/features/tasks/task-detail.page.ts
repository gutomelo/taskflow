import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { TaskDto, TaskPriority } from '@taskflow/contracts';
import { ActiveOrganizationStore } from '../../core/organizations';
import { focusAfterRender } from '../../shared/forms/form-focus';
import { ActiveProjectStore } from '../projects/active-project.store';
import { TaskApi } from './task-api';
import { TaskComments } from './comments/task-comments';
import { TaskAssignee } from './task-assignee';
import { TASK_DELETED_STATE, TaskDetailStore } from './task-detail.store';
import { TaskRelations } from './task-relations';
import { PRIORITY_LABELS, taskDetailMessages } from './tasks.messages';

/** Detalhe `/o/:slug/projects/:key/tasks/:number` (RF-04 a RF-10, RF-13). Ações só com capacidade da API. */
@Component({
  selector: 'tf-task-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    ReactiveFormsModule,
    RouterLink,
    TaskAssignee,
    TaskComments,
    TaskRelations,
  ],
  providers: [TaskDetailStore],
  template: `
    <section class="mx-auto max-w-3xl px-4 py-6" aria-labelledby="task-title">
      <a routerLink=".." class="text-sm text-muted hover:text-default">{{ m.backToTasks }}</a>
      <p class="sr-only" role="status" aria-live="polite">{{ store.announcement() }}</p>
      @switch (store.status()) {
        @case ('loading') {
          <div class="mt-4 h-24 animate-pulse rounded-md bg-surface-muted" aria-hidden="true"></div>
          <p class="sr-only" role="status">{{ m.loading }}</p>
        }
        @case ('not-found') {
          <p class="mt-4 rounded-md bg-surface-muted px-4 py-3 text-sm" role="alert">
            {{ m.notFound }}
          </p>
        }
        @case ('error') {
          <div class="mt-4" role="alert">
            <p class="text-sm text-error-text">{{ m.loadFailed }}</p>
            <button matButton="outlined" type="button" class="mt-2" (click)="load()">
              {{ m.retry }}
            </button>
          </div>
        }
        @default {
          @if (store.task(); as task) {
            <header class="mt-2">
              <h2 id="task-title" class="flex flex-wrap items-center gap-2 text-xl font-semibold">
                <span class="font-mono text-sm font-normal text-muted">{{ task.key }}</span>
                <span [class.line-through]="task.canceledAt">{{ task.title }}</span>
                @if (task.isRequired) {
                  <span class="rounded bg-surface-muted px-2 py-0.5 text-xs font-normal">{{
                    m.required
                  }}</span>
                }
                @if (task.canceledAt) {
                  <span class="rounded bg-surface-muted px-2 py-0.5 text-xs font-normal">{{
                    m.canceledBadge
                  }}</span>
                }
              </h2>
              @if (task.canceledAt) {
                <p class="mt-1 text-sm text-muted" role="note">{{ m.canceledNotice }}</p>
              }
            </header>

            @if (store.error(); as message) {
              <p
                #errorAlert
                role="alert"
                tabindex="-1"
                class="mt-4 rounded-md bg-surface-muted px-4 py-3 text-sm text-error-text"
              >
                {{ message }}
              </p>
            }

            <section class="mt-6" aria-labelledby="status-title">
              <h3 id="status-title" class="text-sm font-semibold">
                {{ m.status }}: {{ task.status.name }}
              </h3>
              @if (task.actions.transitionTo.length > 0) {
                <div class="mt-2 flex flex-wrap gap-2">
                  @for (statusId of task.actions.transitionTo; track statusId) {
                    <button
                      matButton="outlined"
                      type="button"
                      [disabled]="store.busy()"
                      (click)="move(statusId)"
                    >
                      {{ m.moveTo(store.statusName(statusId)) }}
                    </button>
                  }
                </div>
              } @else {
                <p class="mt-1 text-sm text-muted">{{ m.noTransitions }}</p>
              }
            </section>

            <section class="mt-6" aria-labelledby="details-title">
              <h3 id="details-title" class="text-sm font-semibold">{{ m.details }}</h3>
              @if (task.actions.update) {
                <form
                  class="mt-2 flex flex-col gap-2"
                  [formGroup]="form"
                  (ngSubmit)="save()"
                  novalidate
                >
                  <mat-form-field>
                    <mat-label>{{ m.taskTitle }}</mat-label>
                    <input matInput formControlName="title" autocomplete="off" required />
                    @if (form.controls.title.invalid) {
                      <mat-error>{{ m.errors.INVALID_TASK_TITLE }}</mat-error>
                    }
                  </mat-form-field>
                  <mat-form-field>
                    <mat-label>{{ m.description }}</mat-label>
                    <textarea matInput formControlName="description" rows="4"></textarea>
                  </mat-form-field>
                  <div class="flex flex-wrap gap-4">
                    <label class="flex flex-col gap-1 text-sm">
                      {{ m.priority }}
                      <select
                        class="rounded-md border border-border bg-surface px-2 py-1"
                        formControlName="priority"
                      >
                        @for (priority of priorities; track priority) {
                          <option [value]="priority">{{ labels[priority] }}</option>
                        }
                      </select>
                    </label>
                    <label class="flex flex-col gap-1 text-sm">
                      {{ m.dueDate }}
                      <input
                        type="date"
                        class="rounded-md border border-border bg-surface px-2 py-1"
                        formControlName="dueDate"
                      />
                    </label>
                  </div>
                  <div>
                    <button mat-flat-button type="submit" [disabled]="store.busy()">
                      {{ store.busy() ? m.saving : m.save }}
                    </button>
                  </div>
                </form>
              } @else {
                <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt class="text-muted">{{ m.description }}</dt>
                  <dd class="whitespace-pre-line">{{ task.description ?? m.noDescription }}</dd>
                  <dt class="text-muted">{{ m.priority }}</dt>
                  <dd>{{ labels[task.priority] }}</dd>
                  <dt class="text-muted">{{ m.dueDate }}</dt>
                  <dd>{{ task.dueDate ?? m.noDueDate }}</dd>
                </dl>
              }
            </section>

            <tf-task-assignee />
            <tf-task-relations />
            <tf-task-comments />

            <section class="mt-8 flex flex-wrap gap-2 border-t border-border pt-4">
              @if (task.actions.cancel) {
                <button
                  matButton="outlined"
                  type="button"
                  [disabled]="store.busy()"
                  (click)="setCanceled(true)"
                >
                  {{ m.cancelTask }}
                </button>
              }
              @if (task.actions.reopen) {
                <button
                  matButton="outlined"
                  type="button"
                  [disabled]="store.busy()"
                  (click)="setCanceled(false)"
                >
                  {{ m.reopenTask }}
                </button>
              }
              @if (task.actions.delete) {
                @if (confirmingDelete()) {
                  <p class="w-full text-sm" role="alert">{{ m.confirmDelete }}</p>
                  <button
                    mat-flat-button
                    type="button"
                    [disabled]="store.busy()"
                    (click)="remove()"
                  >
                    {{ m.confirm }}
                  </button>
                  <button matButton type="button" (click)="confirmingDelete.set(false)">
                    {{ m.cancel }}
                  </button>
                } @else {
                  <button matButton="outlined" type="button" (click)="confirmingDelete.set(true)">
                    {{ m.deleteTask }}
                  </button>
                }
              }
            </section>
          }
        }
      }
    </section>
  `,
})
export class TaskDetailPage {
  private readonly api = inject(TaskApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly project = inject(ActiveProjectStore);
  protected readonly store = inject(TaskDetailStore);
  protected readonly m = taskDetailMessages;
  protected readonly labels = PRIORITY_LABELS;
  protected readonly priorities = Object.keys(PRIORITY_LABELS) as ReadonlyArray<TaskPriority>;
  protected readonly confirmingDelete = signal(false);
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  protected readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    description: [''],
    priority: ['none' as TaskPriority],
    dueDate: [''],
  });

  constructor() {
    void this.load();
    // O formulário acompanha o servidor enquanto não há edição em curso: outra ação (status,
    // responsável) nunca descarta texto digitado e não salvo.
    effect(() => {
      const task = this.store.task();
      if (task && untracked(() => this.form.pristine)) untracked(() => this.fill(task));
    });
    // Erro novo recebe o foco (leitores de tela anunciam o alerta).
    effect(() => {
      if (this.store.error())
        untracked(() => focusAfterRender(() => this.errorAlert(), this.injector));
    });
  }

  protected load(): Promise<void> {
    const number = this.route.snapshot.paramMap.get('number') ?? '';
    const project = this.project.project();
    return this.store.load(`${project?.key ?? ''}-${number}`);
  }

  protected move(statusId: string): Promise<boolean> {
    return this.store.run(
      (organizationId, task) => this.api.transition(organizationId, task, statusId),
      this.m.moved(this.store.statusName(statusId)),
    );
  }

  protected async save(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { title, description, priority, dueDate } = this.form.getRawValue();
    const saved = await this.store.run(
      (organizationId, task) =>
        this.api.update(organizationId, task.id, {
          title,
          description: description.trim() === '' ? null : description,
          priority,
          dueDate: dueDate === '' ? null : dueDate,
          version: task.version,
        }),
      this.m.saved,
    );
    // Depois de salvar, ou de um conflito (dados recarregados para revisão), vale o servidor.
    const task = this.store.task();
    if (task && (saved || this.store.lastErrorCode() === 'VERSION_CONFLICT')) this.fill(task);
  }

  protected setCanceled(canceled: boolean): Promise<boolean> {
    return this.store.run(
      (organizationId, task) => this.api.setCanceled(organizationId, task, canceled),
      canceled ? this.m.canceled : this.m.reopened,
    );
  }

  protected async remove(): Promise<void> {
    const key = this.store.task()?.key ?? '';
    const removed = await this.store.run(
      (organizationId, task) => this.api.remove(organizationId, task),
      this.m.deleted(key),
    );
    this.confirmingDelete.set(false);
    if (removed) {
      await this.router.navigate(
        [
          '/o',
          this.organization.organization()?.slug,
          'projects',
          this.project.project()?.key,
          'tasks',
        ],
        {
          state: { [TASK_DELETED_STATE]: key },
        },
      );
    }
  }

  private fill(task: TaskDto): void {
    this.form.reset({
      title: task.title,
      description: task.description ?? '',
      priority: task.priority,
      dueDate: task.dueDate ?? '',
    });
  }
}
