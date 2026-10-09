import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthApi, AuthStore } from '../auth';
import { layoutMessages } from './layout.messages';

type ResendState = 'idle' | 'sending' | 'sent' | 'failed';

/** Aviso persistente para contas não verificadas (BR-013), com reenvio do link (RF-04). */
@Component({
  selector: 'tf-email-verification-banner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.user(); as user) {
      @if (!user.emailVerified) {
        <div
          class="border-b border-warning bg-surface-muted"
          role="region"
          aria-label="Verificação de e-mail"
          data-testid="verification-banner"
        >
          <div
            class="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
          >
            <p class="text-warning-text">{{ messages.body(user.email) }}</p>
            <div class="flex items-center gap-3">
              <p class="text-muted" aria-live="polite">
                @switch (state()) {
                  @case ('sent') {
                    {{ messages.sent }}
                  }
                  @case ('failed') {
                    {{ messages.failed }}
                  }
                }
              </p>
              @if (state() !== 'sent') {
                <button
                  type="button"
                  class="shrink-0 rounded-md border border-border-strong px-3 py-1 font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60"
                  [disabled]="state() === 'sending'"
                  (click)="resend()"
                >
                  {{ state() === 'sending' ? messages.resending : messages.resend }}
                </button>
              }
            </div>
          </div>
        </div>
      }
    }
  `,
})
export class EmailVerificationBanner {
  protected readonly store = inject(AuthStore);
  private readonly api = inject(AuthApi);
  protected readonly messages = layoutMessages.verificationBanner;
  protected readonly state = signal<ResendState>('idle');

  protected async resend(): Promise<void> {
    this.state.set('sending');
    try {
      await this.api.resendEmailVerification();
      this.state.set('sent');
    } catch {
      // Inclui 429 do limite por usuário: a mensagem pede para tentar mais tarde.
      this.state.set('failed');
    }
  }
}
