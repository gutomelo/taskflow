import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { WorkflowDto } from '@taskflow/contracts';
import { ActiveOrganizationStore } from '../../core/organizations';
import { ActiveProjectStore } from './active-project.store';
import { ProjectApi } from './project-api';
import { PROJECT_ROLE_LABELS, projectOverviewMessages } from './projects.messages';

/** Visão geral do projeto (RF-09, RF-11): descrição, papel e o workflow padrão (só leitura). */
@Component({
  selector: 'tf-project-overview-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.project(); as project) {
      <section class="mx-auto max-w-3xl px-4 py-6">
        <dl class="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <dt class="text-sm text-muted">{{ m.description }}</dt>
          <dd class="whitespace-pre-line">{{ project.description ?? m.noDescription }}</dd>
          <dt class="text-sm text-muted">{{ m.key }}</dt>
          <dd class="font-mono">{{ project.key }}</dd>
          <dt class="text-sm text-muted">{{ m.yourRole }}</dt>
          <dd>{{ roles[project.myRole] }}</dd>
        </dl>

        <h2 class="mt-8 text-lg font-semibold" id="workflow-title">{{ m.workflow }}</h2>
        <p class="text-sm text-muted">{{ m.workflowHint }}</p>
        @if (workflowFailed()) {
          <p class="mt-3 text-sm text-error-text" role="alert">{{ m.workflowFailed }}</p>
        } @else if (workflow(); as flow) {
          <ol class="mt-3 flex flex-wrap gap-2" aria-labelledby="workflow-title">
            @for (status of flow.statuses; track status.id) {
              <li class="rounded-md border border-border px-3 py-1 text-sm">
                {{ status.name }}
                <span class="sr-only">({{ m.categories[status.category] }})</span>
              </li>
            }
          </ol>
          <ul class="mt-3 text-sm text-muted">
            @for (transition of transitions(); track transition) {
              <li>{{ transition }}</li>
            }
          </ul>
        } @else {
          <p class="mt-3 text-sm text-muted" role="status">{{ m.workflowLoading }}</p>
        }
      </section>
    }
  `,
})
export class ProjectOverviewPage {
  private readonly api = inject(ProjectApi);
  private readonly organization = inject(ActiveOrganizationStore);
  protected readonly store = inject(ActiveProjectStore);
  protected readonly m = projectOverviewMessages;
  protected readonly roles = PROJECT_ROLE_LABELS;
  protected readonly workflow = signal<WorkflowDto | null>(null);
  protected readonly workflowFailed = signal(false);
  protected readonly transitions = computed(() => {
    const flow = this.workflow();
    if (!flow) return [];
    const names = new Map(flow.statuses.map((status) => [status.id, status.name]));
    return flow.transitions.map((transition) =>
      this.m.transition(
        names.get(transition.fromStatusId) ?? '?',
        names.get(transition.toStatusId) ?? '?',
      ),
    );
  });

  constructor() {
    void this.loadWorkflow();
  }

  private async loadWorkflow(): Promise<void> {
    try {
      this.workflow.set(
        await this.api.workflow(this.organization.requireId(), this.store.requireId()),
      );
    } catch (error) {
      if (!this.store.handle(error)) this.workflowFailed.set(true);
    }
  }
}
