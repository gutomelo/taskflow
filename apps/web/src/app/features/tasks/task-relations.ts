import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import type { TaskDto, TaskSummary } from '@taskflow/contracts';
import { toApiProblem } from '../../core/http/api-problem';
import { ActiveOrganizationStore } from '../../core/organizations';
import { ActiveProjectStore } from '../projects/active-project.store';
import { CreateTaskForm } from './create-task-form';
import { TaskApi } from './task-api';
import { TaskDetailStore } from './task-detail.store';
import { taskDetailMessages } from './tasks.messages';

const TASK_KEY = /^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}$/;

/** Subtarefas (RF-02) e dependências (RF-08) da tarefa aberta. */
@Component({
  selector: 'tf-task-relations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CreateTaskForm, MatButton, RouterLink],
  template: `
    @if (store.task(); as task) {
      <section class="mt-8" aria-labelledby="subtasks-title">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h3 id="subtasks-title" class="text-sm font-semibold">{{ m.subtasks }}</h3>
          @if (canCreateSubtask(task) && !creating()) {
            <button matButton="outlined" type="button" (click)="creating.set(true)">
              {{ m.newSubtask }}
            </button>
          }
        </div>
        @if (creating()) {
          <div class="mt-2">
            <tf-create-task-form
              [projectId]="task.projectId"
              [parentTaskId]="task.id"
              [heading]="m.newSubtask"
              [submitLabel]="m.createSubtask"
              [requiredLabel]="m.subtaskRequired"
              (created)="subtaskCreated($event)"
              (canceled)="creating.set(false)"
              (failed)="project.handle($event)"
            />
          </div>
        }
        @if (task.subtasks.length === 0) {
          <p class="mt-2 text-sm text-muted">{{ m.noSubtasks }}</p>
        } @else {
          <ul
            class="mt-2 divide-y divide-border rounded-md border border-border"
            [attr.aria-label]="m.subtasks"
          >
            @for (subtask of task.subtasks; track subtask.id) {
              <li class="px-3 py-2 text-sm">
                <a [routerLink]="['..', String(subtask.number)]" class="hover:underline">
                  <span class="font-mono text-xs text-muted">{{ subtask.key }}</span>
                  {{ subtask.title }}
                </a>
                <span class="ml-2 text-xs text-muted">{{ subtask.status.name }}</span>
                @if (subtask.isRequired) {
                  <span class="ml-2 rounded bg-surface-muted px-2 py-0.5 text-xs">{{
                    m.required
                  }}</span>
                }
                @if (subtask.canceledAt) {
                  <span class="ml-2 rounded bg-surface-muted px-2 py-0.5 text-xs">{{
                    m.canceledBadge
                  }}</span>
                }
              </li>
            }
          </ul>
        }
      </section>

      <section class="mt-8" aria-labelledby="blocked-by-title">
        <h3 id="blocked-by-title" class="text-sm font-semibold">{{ m.blockedBy }}</h3>
        @if (task.blockedBy.length === 0) {
          <p class="mt-2 text-sm text-muted">{{ m.noBlockers }}</p>
        } @else {
          <ul class="mt-2 space-y-1" [attr.aria-label]="m.blockedBy">
            @for (blocker of task.blockedBy; track blocker.id) {
              <li class="flex items-center gap-2 text-sm">
                <a [routerLink]="['..', String(blocker.number)]" class="hover:underline">
                  <span class="font-mono text-xs text-muted">{{ blocker.key }}</span>
                  {{ blocker.title }}
                </a>
                <span class="text-xs text-muted">{{ blocker.status.name }}</span>
                @if (task.actions.update) {
                  <button
                    matButton
                    type="button"
                    [attr.aria-label]="m.removeBlocker(blocker.key)"
                    [disabled]="store.busy()"
                    (click)="removeBlocker(blocker)"
                  >
                    ✕
                  </button>
                }
              </li>
            }
          </ul>
        }
        @if (task.actions.update) {
          <form class="mt-2 flex flex-wrap items-end gap-2" (submit)="addBlocker($event)">
            <label class="flex flex-col gap-1 text-sm">
              {{ m.blockerKey }}
              <input
                class="rounded-md border border-border bg-surface px-2 py-1 font-mono"
                [value]="blockerKey()"
                (input)="typed($event)"
                autocomplete="off"
                spellcheck="false"
                [attr.aria-invalid]="keyError() !== null"
                [attr.aria-describedby]="keyError() ? 'blocker-key-error' : null"
              />
            </label>
            <button matButton="outlined" type="submit" [disabled]="store.busy()">
              {{ m.add }}
            </button>
            @if (keyError(); as message) {
              <p id="blocker-key-error" class="w-full text-sm text-error-text">{{ message }}</p>
            }
          </form>
        }
      </section>

      <section class="mt-8" aria-labelledby="blocking-title">
        <h3 id="blocking-title" class="text-sm font-semibold">{{ m.blocking }}</h3>
        @if (task.blocking.length === 0) {
          <p class="mt-2 text-sm text-muted">{{ m.noBlocking }}</p>
        } @else {
          <ul class="mt-2 space-y-1" [attr.aria-label]="m.blocking">
            @for (blocked of task.blocking; track blocked.id) {
              <li class="text-sm">
                <a [routerLink]="['..', String(blocked.number)]" class="hover:underline">
                  <span class="font-mono text-xs text-muted">{{ blocked.key }}</span>
                  {{ blocked.title }}
                </a>
              </li>
            }
          </ul>
          @if (task.blockingTruncated) {
            <p class="mt-1 text-xs text-muted">{{ m.blockingTruncated }}</p>
          }
        }
      </section>
    }
  `,
})
export class TaskRelations {
  private readonly api = inject(TaskApi);
  private readonly organization = inject(ActiveOrganizationStore);
  protected readonly store = inject(TaskDetailStore);
  protected readonly project = inject(ActiveProjectStore);
  protected readonly m = taskDetailMessages;
  protected readonly String = String;
  protected readonly creating = signal(false);
  protected readonly blockerKey = signal('');
  protected readonly keyError = signal<string | null>(null);

  /** Um nível só (RF-02): subtarefa não ganha subtarefas. */
  protected canCreateSubtask(task: TaskDto): boolean {
    return task.parentTaskId === null && this.project.can('task:create');
  }

  protected async subtaskCreated(subtask: TaskDto): Promise<void> {
    this.creating.set(false);
    await this.store.refresh();
    this.store.announcement.set(this.m.subtaskCreated(subtask.key));
  }

  protected typed(event: Event): void {
    const value = event.target instanceof HTMLInputElement ? event.target.value : '';
    this.blockerKey.set(value.trim().toUpperCase());
    this.keyError.set(null);
  }

  protected async addBlocker(event: Event): Promise<void> {
    event.preventDefault();
    const key = this.blockerKey();
    if (!TASK_KEY.test(key)) {
      this.keyError.set(this.m.invalidKey);
      return;
    }
    // A chave digitada é resolvida antes: "não existe" é erro do campo, não da tarefa aberta.
    let blocker: TaskDto;
    try {
      blocker = await this.api.getByKey(this.organization.requireId(), key);
    } catch (error) {
      if (this.project.handle(error)) return;
      this.keyError.set(
        toApiProblem(error).status === 404 ? this.m.blockerNotFound : this.m.blockerLookupFailed,
      );
      return;
    }
    if (blocker.projectId !== this.store.task()?.projectId) {
      this.keyError.set(this.m.blockerNotFound);
      return;
    }
    const added = await this.store.run(
      (organizationId, task) => this.api.addDependency(organizationId, task.id, blocker.id),
      this.m.blockerAdded(key),
    );
    if (added) this.blockerKey.set('');
  }

  protected async removeBlocker(blocker: TaskSummary): Promise<void> {
    await this.store.run(async (organizationId, task) => {
      await this.api.removeDependency(organizationId, task.id, blocker.id);
      await this.store.refresh();
    }, this.m.blockerRemoved(blocker.key));
  }
}
