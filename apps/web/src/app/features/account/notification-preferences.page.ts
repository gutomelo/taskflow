import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { NotificationApi } from '../notifications/notification-api';
import { notificationsMessages } from '../notifications/notifications.messages';

type Status = 'loading' | 'loaded' | 'error';

/**
 * "Notificações da conta" (spec 008, RF-09): liga e desliga o resumo por e-mail. O link do
 * próprio e-mail leva para cá. As notificações dentro do app chegam sempre.
 */
@Component({
  selector: 'tf-notification-preferences-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-3xl px-4 py-10">
      <h1 class="text-2xl font-semibold tracking-tight">{{ messages.page.title }}</h1>
      <p class="mt-1 text-sm text-muted">{{ messages.page.subtitle }}</p>

      <section
        class="mt-8 rounded-lg border border-border bg-surface p-5 shadow-sm"
        aria-labelledby="email-digest-title"
      >
        <h2 id="email-digest-title" class="text-lg font-semibold">
          {{ messages.preference.title }}
        </h2>
        <p class="mb-4 text-sm text-muted">{{ messages.preference.description }}</p>
        @switch (status()) {
          @case ('loading') {
            <p class="text-sm text-muted" role="status">{{ messages.preference.loading }}</p>
          }
          @case ('error') {
            <div role="alert">
              <p class="text-sm text-error-text">{{ messages.preference.loadFailed }}</p>
              <button
                type="button"
                class="mt-2 text-sm font-medium text-primary underline focus-visible:outline-2 focus-visible:outline-focus"
                (click)="load()"
              >
                {{ messages.retry }}
              </button>
            </div>
          }
          @default {
            <label class="inline-flex cursor-pointer items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                role="switch"
                class="size-5 accent-[var(--tf-color-primary)] focus-visible:outline-2 focus-visible:outline-focus"
                [checked]="emailDigest()"
                [attr.aria-checked]="emailDigest()"
                [disabled]="saving()"
                (change)="toggle($event)"
              />
              {{ messages.preference.label }}
            </label>
          }
        }
        <p class="mt-3 text-sm" aria-live="polite">{{ feedback() }}</p>
        @if (error()) {
          <p role="alert" class="mt-1 text-sm text-error-text">{{ error() }}</p>
        }
      </section>
    </div>
  `,
})
export class NotificationPreferencesPage {
  private readonly api = inject(NotificationApi);
  protected readonly messages = notificationsMessages;
  protected readonly status = signal<Status>('loading');
  protected readonly emailDigest = signal(true);
  protected readonly saving = signal(false);
  protected readonly feedback = signal('');
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.status.set('loading');
    try {
      this.emailDigest.set((await this.api.preference()).emailDigest);
      this.status.set('loaded');
    } catch {
      this.status.set('error');
    }
  }

  protected async toggle(event: Event): Promise<void> {
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    const wanted = input.checked;
    this.saving.set(true);
    this.error.set(null);
    this.feedback.set('');
    try {
      const saved = await this.api.updatePreference(wanted);
      this.emailDigest.set(saved.emailDigest);
      this.feedback.set(this.messages.preference.saved(saved.emailDigest));
    } catch {
      // Volta o interruptor ao valor salvo.
      input.checked = this.emailDigest();
      this.error.set(this.messages.preference.saveFailed);
    } finally {
      this.saving.set(false);
    }
  }
}
