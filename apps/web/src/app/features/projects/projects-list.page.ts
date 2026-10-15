import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import type { ProjectSummary } from '@taskflow/contracts';
import { ActiveOrganizationStore } from '../../core/organizations';
import { ProjectApi } from './project-api';
import { PROJECT_ROLE_LABELS, projectListMessages } from './projects.messages';

type Status = 'loading' | 'loaded' | 'error';

/** Lista de projetos visíveis (RF-02, RF-11): ativos por padrão, arquivados sob filtro. */
@Component({
  selector: 'tf-projects-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, RouterLink],
  template: `
    <section class="mx-auto max-w-3xl px-4 py-10" aria-labelledby="projects-title">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 id="projects-title" class="text-2xl font-semibold tracking-tight">{{ m.title }}</h1>
          <p class="mt-1 text-sm text-muted">{{ seesAll() ? m.introAll : m.intro }}</p>
        </div>
        @if (active.can('project:create')) {
          <a mat-flat-button routerLink="new">{{ m.create }}</a>
        }
      </div>

      @if (notFound) {
        <p class="mt-6 rounded-md bg-surface-muted px-4 py-3 text-sm" role="status">
          {{ m.notFound }}
        </p>
      }

      <div class="mt-6 flex gap-2" role="group" [attr.aria-label]="m.filterLabel">
        @for (option of filters; track option.archived) {
          <button
            type="button"
            class="rounded-full border px-3 py-1 text-sm focus-visible:outline-2 focus-visible:outline-focus"
            [class.border-primary]="archived() === option.archived"
            [class.border-border]="archived() !== option.archived"
            [attr.aria-pressed]="archived() === option.archived"
            (click)="show(option.archived)"
          >
            {{ option.label }}
          </button>
        }
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
            <p class="mt-6 text-sm text-muted">{{ archived() ? m.emptyArchived : m.empty }}</p>
          } @else {
            <ul
              class="mt-6 divide-y divide-border rounded-md border border-border"
              [attr.aria-label]="m.listLabel"
            >
              @for (project of items(); track project.id) {
                <li>
                  <a
                    [routerLink]="project.key"
                    class="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <span>
                      <span class="font-medium">{{ project.name }}</span>
                      <span class="ml-2 font-mono text-xs text-muted">{{ project.key }}</span>
                    </span>
                    <span class="text-xs text-muted">
                      @if (project.archived) {
                        <span class="mr-2 rounded bg-surface-muted px-2 py-0.5">{{
                          m.archivedBadge
                        }}</span>
                      }
                      {{ m.yourRole(roleLabel(project).toLowerCase()) }}
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
export class ProjectsListPage {
  private readonly api = inject(ProjectApi);
  protected readonly active = inject(ActiveOrganizationStore);
  protected readonly m = projectListMessages;
  protected readonly filters = [
    { archived: false, label: projectListMessages.active },
    { archived: true, label: projectListMessages.archived },
  ] as const;

  /** Vindo da área de um projeto sem acesso (404 numa chamada ou chave inexistente). */
  protected readonly notFound =
    inject(Router).currentNavigation()?.extras.state?.['projectNotFound'] === true;
  protected readonly archived = signal(false);
  protected readonly status = signal<Status>('loading');
  protected readonly items = signal<ReadonlyArray<ProjectSummary>>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  /** Owner/admin veem todos (BR-023): só muda o texto; a lista vem filtrada da API. */
  protected readonly seesAll = computed(() => {
    const role = this.active.role();
    return role === 'owner' || role === 'admin';
  });
  /** Descarta respostas de um filtro anterior (troca rápida entre Ativos e Arquivados). */
  private generation = 0;

  constructor() {
    void this.load();
  }

  protected show(archived: boolean): void {
    if (this.archived() === archived) return;
    this.archived.set(archived);
    void this.load();
  }

  protected roleLabel(project: ProjectSummary): string {
    return PROJECT_ROLE_LABELS[project.myRole];
  }

  protected async load(): Promise<void> {
    const generation = (this.generation += 1);
    this.status.set('loading');
    try {
      const page = await this.api.list(this.active.requireId(), {
        archived: this.archived(),
        cursor: null,
      });
      if (generation !== this.generation) return;
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.status.set('loaded');
    } catch {
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
      const page = await this.api.list(this.active.requireId(), {
        archived: this.archived(),
        cursor,
      });
      if (generation !== this.generation) return;
      this.items.update((items) => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch {
      if (generation === this.generation) this.status.set('error');
    } finally {
      this.loadingMore.set(false);
    }
  }
}
