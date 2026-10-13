import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ActiveProjectStore } from './active-project.store';
import { projectAreaMessages } from './projects.messages';

/** Área `/o/:slug/projects/:key` (RF-11): carrega o projeto pela chave e provê o store. */
@Component({
  selector: 'tf-project-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, RouterLink, RouterLinkActive, RouterOutlet],
  providers: [ActiveProjectStore],
  template: `
    @switch (store.status()) {
      @case ('loading') {
        <div class="mx-auto max-w-3xl px-4 py-10" aria-hidden="true">
          <div class="h-8 w-1/2 animate-pulse rounded-md bg-surface-muted"></div>
          <div class="mt-4 h-24 animate-pulse rounded-md bg-surface-muted"></div>
        </div>
        <p class="sr-only" role="status">{{ m.loading }}</p>
      }
      @case ('error') {
        <div class="mx-auto max-w-3xl px-4 py-10" role="alert">
          <p class="text-sm text-error-text">{{ m.loadFailed }}</p>
          <button matButton="outlined" type="button" class="mt-2" (click)="store.reload()">
            {{ m.retry }}
          </button>
        </div>
      }
      @default {
        @if (store.project(); as project) {
          <header class="mx-auto max-w-3xl px-4 pt-8">
            <a routerLink=".." class="text-sm text-muted hover:text-default">{{
              m.backToProjects
            }}</a>
            <h1
              class="mt-1 flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight"
            >
              {{ project.name }}
              <span class="font-mono text-sm font-normal text-muted">{{ project.key }}</span>
              @if (store.isArchived()) {
                <span class="rounded bg-surface-muted px-2 py-0.5 text-xs font-normal">{{
                  m.archivedBadge
                }}</span>
              }
            </h1>
            @if (store.isArchived()) {
              <p class="mt-2 text-sm text-muted" role="note">{{ m.archivedNotice }}</p>
            }
            <nav class="mt-4 border-b border-border" [attr.aria-label]="m.sectionNav">
              <ul class="flex gap-1 overflow-x-auto">
                @for (link of links; track link.path) {
                  <li>
                    <a
                      [routerLink]="link.path"
                      routerLinkActive="border-primary text-default"
                      [routerLinkActiveOptions]="{ exact: true }"
                      ariaCurrentWhenActive="page"
                      class="inline-block border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-default focus-visible:outline-2 focus-visible:outline-focus"
                    >
                      {{ link.label }}
                    </a>
                  </li>
                }
              </ul>
            </nav>
          </header>
          <router-outlet />
        }
      }
    }
  `,
})
export class ProjectLayout {
  protected readonly store = inject(ActiveProjectStore);
  protected readonly m = projectAreaMessages;
  protected readonly links: ReadonlyArray<{ path: string; label: string }> = [
    { path: '.', label: projectAreaMessages.overview },
    { path: 'members', label: projectAreaMessages.members },
    { path: 'settings', label: projectAreaMessages.settings },
  ];

  constructor() {
    // A rota é recriada quando a chave muda (RECREATE_ON_PARAM_CHANGE): ler uma vez basta.
    void this.store.load(inject(ActivatedRoute).snapshot.paramMap.get('key') ?? '');
  }
}
