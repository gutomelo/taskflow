import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import type { StatusCategory, WorkflowDto } from '@taskflow/contracts';
import { toApiProblem } from '../../core/http/api-problem';
import { ActiveOrganizationStore } from '../../core/organizations';
import { commonErrorMessage, formMessages } from '../../shared/forms/form.messages';
import { codeMessage } from '../organizations/organizations.messages';
import { ActiveProjectStore } from './active-project.store';
import { ProjectApi } from './project-api';
import { projectOverviewMessages, workflowSettingsMessages } from './projects.messages';

type Status = WorkflowDto['statuses'][number];
const CATEGORIES: ReadonlyArray<StatusCategory> = ['todo', 'in_progress', 'done'];
const valueOf = (event: Event) =>
  event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement
    ? event.target.value
    : '';

/**
 * Configuração do fluxo (spec 005, RF-05 a RF-09): status e transições, com a versão do workflow
 * em toda edição. Só aparece com a capacidade `board:configure` da API; a API sempre decide.
 */
/** Recusas que indicam fluxo velho na tela (corrida com outra pessoa): recarrega depois da mensagem. */
const STALE = new Set([
  'VERSION_CONFLICT',
  'STATUS_NOT_FOUND',
  'STATUS_IN_USE',
  'STATUS_NAME_TAKEN',
]);

@Component({
  selector: 'tf-workflow-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
  template: `
    <section class="mt-10 border-t border-border pt-6" aria-labelledby="workflow-settings-title">
      <h2 id="workflow-settings-title" class="text-lg font-semibold">{{ m.title }}</h2>
      <p class="mt-1 text-sm text-muted">{{ m.intro }}</p>
      <p class="sr-only" role="status" aria-live="polite">{{ announcement() }}</p>
      @if (error(); as message) {
        <p class="mt-4 rounded-md bg-surface-muted px-4 py-3 text-sm text-error-text" role="alert">
          {{ message }}
        </p>
      }
      @if (workflow(); as flow) {
        <ul class="mt-4 space-y-3" [attr.aria-label]="m.statusesLabel">
          @for (status of flow.statuses; track status.id; let first = $first; let last = $last) {
            <li
              class="rounded-md border border-border p-3 text-sm"
              [attr.data-status-id]="status.id"
            >
              <div class="flex flex-wrap items-end gap-2">
                <label class="flex flex-col gap-1">
                  <span class="sr-only">{{ m.name(status.name) }}</span>
                  <input
                    class="rounded-md border border-border bg-surface px-2 py-1"
                    [value]="status.name"
                    [attr.aria-label]="m.name(status.name)"
                    (input)="names.set(status.id, valueOf($event))"
                  />
                </label>
                <button matButton type="button" [disabled]="busy()" (click)="rename(status)">
                  {{ m.rename }}
                </button>
                <label class="flex flex-col gap-1">
                  <span class="sr-only">{{ m.category(status.name) }}</span>
                  <select
                    class="rounded-md border border-border bg-surface px-2 py-1"
                    [attr.aria-label]="m.category(status.name)"
                    [disabled]="status.inUse || busy()"
                    (change)="changeCategory(status, $event)"
                  >
                    @for (category of categories; track category) {
                      <option [value]="category" [selected]="category === status.category">
                        {{ categoryLabels[category] }}
                      </option>
                    }
                  </select>
                </label>
                <button
                  matButton
                  type="button"
                  [attr.aria-label]="m.up(status.name)"
                  [disabled]="first || busy()"
                  (click)="shift(status, -1)"
                >
                  ↑
                </button>
                <button
                  matButton
                  type="button"
                  [attr.aria-label]="m.down(status.name)"
                  [disabled]="last || busy()"
                  (click)="shift(status, 1)"
                >
                  ↓
                </button>
                <button
                  matButton
                  type="button"
                  [disabled]="busy()"
                  (click)="removing.set(status.id)"
                >
                  {{ m.remove(status.name) }}
                </button>
              </div>
              @if (status.inUse) {
                <p class="mt-1 text-xs text-muted">{{ m.categoryLocked }}</p>
              }
              @if (removing() === status.id) {
                <div
                  class="mt-2 flex flex-wrap items-end gap-2"
                  role="group"
                  [attr.aria-label]="m.remove(status.name)"
                >
                  @if (status.inUse) {
                    @if (targetsFor(status).length > 0) {
                      <label class="flex flex-col gap-1">
                        {{ m.target }}
                        <select
                          class="rounded-md border border-border bg-surface px-2 py-1"
                          (change)="target.set(valueOf($event))"
                        >
                          <option value=""></option>
                          @for (option of targetsFor(status); track option.id) {
                            <option [value]="option.id">{{ option.name }}</option>
                          }
                        </select>
                      </label>
                    } @else {
                      <p class="text-xs">{{ m.noTarget }}</p>
                    }
                  }
                  <button
                    mat-flat-button
                    type="button"
                    [disabled]="busy()"
                    (click)="remove(status)"
                  >
                    {{ m.confirmRemove }}
                  </button>
                  <button matButton type="button" (click)="removing.set(null)">
                    {{ m.cancel }}
                  </button>
                </div>
              }
            </li>
          }
        </ul>

        <form
          class="mt-4 flex flex-wrap items-end gap-2"
          (submit)="create($event)"
          [attr.aria-label]="m.newStatus"
        >
          <label class="flex flex-col gap-1 text-sm">
            {{ m.newName }}
            <input
              class="rounded-md border border-border bg-surface px-2 py-1"
              [value]="newName()"
              (input)="newName.set(valueOf($event))"
            />
          </label>
          <label class="flex flex-col gap-1 text-sm">
            {{ m.newCategory }}
            <select
              class="rounded-md border border-border bg-surface px-2 py-1"
              (change)="newCategory.set(categoryOf($event))"
            >
              @for (category of categories; track category) {
                <option [value]="category" [selected]="category === newCategory()">
                  {{ categoryLabels[category] }}
                </option>
              }
            </select>
          </label>
          <button matButton="outlined" type="submit" [disabled]="busy()">{{ m.create }}</button>
        </form>

        <fieldset class="mt-6">
          <legend class="text-sm font-semibold">{{ m.transitionsTitle }}</legend>
          <p class="text-xs text-muted">{{ m.transitionsHint }}</p>
          <div class="mt-2 space-y-1">
            @for (from of flow.statuses; track from.id) {
              @for (to of flow.statuses; track to.id) {
                @if (from.id !== to.id) {
                  <label class="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      [checked]="allowed(from.id, to.id)"
                      (change)="toggle(from.id, to.id)"
                    />
                    {{ m.transition(from.name, to.name) }}
                  </label>
                }
              }
            }
          </div>
          <button
            matButton="outlined"
            type="button"
            class="mt-2"
            [disabled]="busy()"
            (click)="saveTransitions()"
          >
            {{ m.saveTransitions }}
          </button>
        </fieldset>
      } @else if (loadFailed()) {
        <div class="mt-4" role="alert">
          <p class="text-sm text-error-text">{{ m.loadFailed }}</p>
          <button matButton="outlined" type="button" (click)="load()">{{ m.retry }}</button>
        </div>
      } @else {
        <p class="mt-4 text-sm text-muted" role="status">{{ m.loading }}</p>
      }
    </section>
  `,
})
export class WorkflowSettings {
  private readonly api = inject(ProjectApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly project = inject(ActiveProjectStore);
  protected readonly m = workflowSettingsMessages;
  protected readonly categories = CATEGORIES;
  protected readonly categoryLabels = projectOverviewMessages.categories;
  protected readonly valueOf = valueOf;

  protected readonly workflow = signal<WorkflowDto | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly announcement = signal('');
  protected readonly removing = signal<string | null>(null);
  protected readonly target = signal('');
  protected readonly newName = signal('');
  protected readonly newCategory = signal<StatusCategory>('in_progress');
  /** Nomes digitados e ainda não salvos, por status. */
  protected readonly names = new Map<string, string>();
  /** Transições marcadas na matriz (rascunho até "Salvar transições"). */
  private readonly draft = signal<ReadonlySet<string>>(new Set());
  private readonly projectId = computed(() => this.project.requireId());

  constructor() {
    void this.load();
  }

  protected categoryOf(event: Event): StatusCategory {
    const value = valueOf(event);
    return CATEGORIES.find((category) => category === value) ?? 'todo';
  }

  protected allowed(from: string, to: string): boolean {
    return this.draft().has(`${from}>${to}`);
  }

  protected toggle(from: string, to: string): void {
    const key = `${from}>${to}`;
    const next = new Set(this.draft());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.draft.set(next);
  }

  /** Destinos da remoção: outros status da mesma categoria (D2). */
  protected targetsFor(status: Status): ReadonlyArray<Status> {
    return (this.workflow()?.statuses ?? []).filter(
      (candidate) => candidate.id !== status.id && candidate.category === status.category,
    );
  }

  async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      this.apply(await this.api.workflow(this.organization.requireId(), this.projectId()));
    } catch (error) {
      if (!this.project.handle(error)) this.loadFailed.set(true);
    }
  }

  protected rename(status: Status): Promise<void> {
    const name = this.names.get(status.id) ?? status.name;
    return this.run((org, project, version) =>
      this.api.updateStatus(org, project, status.id, { name, version }),
    );
  }

  protected changeCategory(status: Status, event: Event): Promise<void> {
    const category = this.categoryOf(event);
    return this.run((org, project, version) =>
      this.api.updateStatus(org, project, status.id, { category, version }),
    );
  }

  protected shift(status: Status, delta: number): Promise<void> {
    const ids = (this.workflow()?.statuses ?? []).map((item) => item.id);
    const from = ids.indexOf(status.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return Promise.resolve();
    [ids[from], ids[to]] = [ids[to] ?? '', ids[from] ?? ''];
    return this.run((org, project, version) =>
      this.api.reorderStatuses(org, project, { statusIds: ids, version }),
    );
  }

  protected remove(status: Status): Promise<void> {
    const moveTasksToStatusId = status.inUse ? this.target() || null : null;
    return this.run((org, project, version) =>
      this.api.removeStatus(org, project, status.id, { version, moveTasksToStatusId }),
    );
  }

  protected create(event: Event): Promise<void> {
    event.preventDefault();
    const name = this.newName();
    const category = this.newCategory();
    return this.run(async (org, project, version) => {
      const workflow = await this.api.createStatus(org, project, { name, category, version });
      this.newName.set('');
      return workflow;
    });
  }

  protected saveTransitions(): Promise<void> {
    const transitions = [...this.draft()].map((key) => {
      const [fromStatusId = '', toStatusId = ''] = key.split('>');
      return { fromStatusId, toStatusId };
    });
    return this.run((org, project, version) =>
      this.api.replaceTransitions(org, project, { transitions, version }),
    );
  }

  private apply(workflow: WorkflowDto): void {
    this.workflow.set(workflow);
    this.draft.set(new Set(workflow.transitions.map((t) => `${t.fromStatusId}>${t.toStatusId}`)));
    this.names.clear();
    this.removing.set(null);
    this.target.set('');
  }

  private async run(
    action: (organizationId: string, projectId: string, version: number) => Promise<WorkflowDto>,
  ): Promise<void> {
    const current = this.workflow();
    if (!current || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.apply(await action(this.organization.requireId(), this.projectId(), current.version));
      this.announcement.set(this.m.saved);
    } catch (error) {
      if (this.project.handle(error)) return;
      const problem = toApiProblem(error);
      this.error.set(
        commonErrorMessage(problem) ??
          codeMessage(this.m.errors, problem.code) ??
          formMessages.errors.unexpected,
      );
      if (STALE.has(problem.code ?? '')) await this.load();
    } finally {
      this.busy.set(false);
    }
  }
}
