import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../auth';
import { EmailVerificationBanner } from './email-verification-banner';
import { layoutMessages } from './layout.messages';
import { UserMenu } from './user-menu';

/**
 * Layout da aplicação: cabeçalho com a marca e, autenticado, o menu da conta e o aviso de
 * verificação de e-mail. A navegação lateral e o seletor de organização chegam com a spec 002.
 */
@Component({
  selector: 'tf-app-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmailVerificationBanner, RouterLink, UserMenu],
  host: { class: 'flex min-h-dvh flex-col' },
  template: `
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-default focus:shadow-md"
    >
      {{ messages.skipLink }}
    </a>
    <header class="bg-sidebar text-on-sidebar">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
        <a
          routerLink="/"
          class="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-focus"
        >
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
        </a>
        <!-- Menu (Material + overlay do CDK) baixado só com sessão: anônimos não pagam por ele. -->
        @defer (when store.isAuthenticated()) {
          @if (store.isAuthenticated()) {
            <div class="ms-auto">
              <tf-user-menu (signOutFailed)="signOutFailed.set(true)" />
            </div>
          }
        }
      </div>
    </header>
    @if (signOutFailed() && store.isAuthenticated()) {
      <div role="alert" class="bg-surface-muted px-4 py-2 text-center text-sm text-error-text">
        {{ messages.userMenu.signOutFailed }}
      </div>
    }
    <tf-email-verification-banner />
    <main id="main-content" tabindex="-1" class="flex-1 focus:outline-none">
      <ng-content />
    </main>
  `,
})
export class AppShell {
  protected readonly store = inject(AuthStore);
  protected readonly messages = layoutMessages;
  protected readonly signOutFailed = signal(false);
}
