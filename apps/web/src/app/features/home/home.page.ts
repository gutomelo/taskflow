import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth';

// Textos de interface centralizados (pt-BR) para facilitar a futura internacionalização.
const homeMessages = {
  greeting: (name: string) => `Olá, ${name}!`,
  intro: 'Sua conta está pronta. Organizações, projetos e quadros chegam nas próximas versões.',
  securityTitle: 'Segurança da conta',
  securityBody: 'Veja onde sua conta está conectada e troque sua senha.',
  statusTitle: 'Status do sistema',
  statusBody: 'Verifique se a API e os serviços estão operacionais.',
} as const;

/** Página inicial autenticada (spec 001). */
@Component({
  selector: 'tf-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="mx-auto max-w-3xl px-4 py-10" aria-labelledby="home-title">
      <h1 id="home-title" class="text-2xl font-semibold tracking-tight">
        {{ messages.greeting(store.user()?.name ?? '') }}
      </h1>
      <p class="mt-1 text-sm text-muted">{{ messages.intro }}</p>
      <ul class="mt-8 grid gap-4 sm:grid-cols-2">
        <li>
          <a
            routerLink="/account/security"
            class="block h-full rounded-lg border border-border bg-surface p-5 shadow-sm hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span class="font-medium">{{ messages.securityTitle }}</span>
            <span class="mt-1 block text-sm text-muted">{{ messages.securityBody }}</span>
          </a>
        </li>
        <li>
          <a
            routerLink="/status"
            class="block h-full rounded-lg border border-border bg-surface p-5 shadow-sm hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span class="font-medium">{{ messages.statusTitle }}</span>
            <span class="mt-1 block text-sm text-muted">{{ messages.statusBody }}</span>
          </a>
        </li>
      </ul>
    </section>
  `,
})
export class HomePage {
  protected readonly store = inject(AuthStore);
  protected readonly messages = homeMessages;
}
