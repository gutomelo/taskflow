import { ChangeDetectionStrategy, Component, viewChild } from '@angular/core';
import { accountMessages } from './account.messages';
import { ActiveSessions } from './active-sessions';
import { ChangePasswordForm } from './change-password-form';

/** Página "Segurança da conta" (spec 001): sessões ativas e troca de senha. */
@Component({
  selector: 'tf-security-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActiveSessions, ChangePasswordForm],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-10">
      <h1 class="text-2xl font-semibold tracking-tight">{{ messages.security.title }}</h1>
      <p class="mt-1 text-sm text-muted">{{ messages.security.subtitle }}</p>

      <section
        class="mt-8 rounded-lg border border-border bg-surface p-5 shadow-sm"
        aria-labelledby="sessions-title"
      >
        <h2 id="sessions-title" class="text-lg font-semibold">{{ messages.sessions.title }}</h2>
        <p class="mb-2 text-sm text-muted">{{ messages.sessions.description }}</p>
        <tf-active-sessions />
      </section>

      <section
        class="mt-6 rounded-lg border border-border bg-surface p-5 shadow-sm"
        aria-labelledby="password-title"
      >
        <h2 id="password-title" class="text-lg font-semibold">
          {{ messages.changePassword.title }}
        </h2>
        <p class="text-sm text-muted">{{ messages.changePassword.description }}</p>
        <tf-change-password-form (changed)="sessions()?.reload()" />
      </section>
    </div>
  `,
})
export class SecurityPage {
  protected readonly messages = accountMessages;
  protected readonly sessions = viewChild(ActiveSessions);
}
