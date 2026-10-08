import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Layout mínimo da Fase 0: cabeçalho com a marca e área de conteúdo.
 * A navegação lateral e o seletor de organização chegam com as specs 001/002.
 */
@Component({
  selector: 'tf-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-dvh flex-col' },
  template: `
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-default focus:shadow-md"
    >
      Pular para o conteúdo
    </a>
    <header class="bg-sidebar text-on-sidebar">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <svg aria-hidden="true" viewBox="0 0 24 24" class="size-7" fill="none">
          <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--tf-color-primary)" />
          <path
            d="M7 8h10M7 12h6M7 16h3"
            stroke="var(--tf-color-on-primary)"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        <span class="text-lg font-semibold tracking-tight">TaskFlow</span>
      </div>
    </header>
    <main id="main-content" tabindex="-1" class="flex-1 focus:outline-none">
      <ng-content />
    </main>
  `,
})
export class AppShell {}
