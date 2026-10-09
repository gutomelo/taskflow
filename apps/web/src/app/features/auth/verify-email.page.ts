import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth';
import { toApiProblem } from '../../core/http/api-problem';
import { AccountApi } from './account-api';
import { AuthCard } from './auth-card';
import { authMessages, commonErrorMessage } from './auth.messages';
import { focusAfterRender } from './form-focus';
import { LinkToken, PendingEmailVerification } from './link-token';

export type VerifyEmailState =
  | 'no_token'
  | 'needs_login'
  | 'ready'
  | 'verified'
  | 'already_verified'
  | 'wrong_account'
  | 'invalid_link'
  | 'resend_sent';

/**
 * CA-03 / CA-16 (BR-017). Nada é confirmado automaticamente: sem sessão, a página só pede login;
 * com sessão, a confirmação exige o clique em "Confirmar e-mail". O token sai da URL na hora e
 * fica apenas em memória.
 */
@Component({
  selector: 'tf-verify-email-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [AuthCard, MatButton, RouterLink],
  templateUrl: './verify-email.page.html',
})
export class VerifyEmailPage {
  private readonly api = inject(AccountApi);
  private readonly pending = inject(PendingEmailVerification);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  protected readonly store = inject(AuthStore);

  protected readonly messages = authMessages;
  protected readonly state = signal<VerifyEmailState>('no_token');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly stateMessage = viewChild<ElementRef<HTMLElement>>('stateMessage');

  constructor() {
    const fromLink = inject(LinkToken).takeFromFragment();
    if (fromLink) this.pending.remember(fromLink);
    this.state.set(this.initialState());
  }

  private initialState(): VerifyEmailState {
    const user = this.store.user();
    if (user?.emailVerified) {
      this.pending.clear();
      return 'already_verified';
    }
    if (!this.pending.current()) return 'no_token';
    return user ? 'ready' : 'needs_login';
  }

  protected goToLogin(): Promise<boolean> {
    return this.router.navigate(['/login'], { queryParams: { returnUrl: '/verify-email' } });
  }

  protected async confirm(): Promise<void> {
    const token = this.pending.current();
    if (!token || this.busy()) return;
    await this.run(async () => {
      try {
        await this.api.confirmEmail({ token });
        this.finish('verified');
      } catch (error) {
        const problem = toApiProblem(error);
        if (problem.code === 'EMAIL_ALREADY_VERIFIED') this.finish('already_verified');
        // O token continua guardado: vale para quem entrar na conta correta.
        else if (problem.code === 'TOKEN_BELONGS_TO_ANOTHER_ACCOUNT') this.moveTo('wrong_account');
        else if (
          problem.code === 'INVALID_OR_EXPIRED_TOKEN' ||
          problem.code === 'VALIDATION_FAILED'
        ) {
          this.pending.clear();
          this.moveTo('invalid_link');
        } else if (problem.status === 401) {
          // Sessão perdida mesmo após o refresh: o interceptor já leva ao login.
          this.moveTo('needs_login');
        } else this.error.set(commonErrorMessage(problem) ?? this.messages.errors.unexpected);
      }
    });
  }

  protected async resend(): Promise<void> {
    if (this.busy()) return;
    await this.run(async () => {
      try {
        await this.api.resendVerification();
        this.moveTo('resend_sent');
      } catch (error) {
        const problem = toApiProblem(error);
        if (problem.code === 'EMAIL_ALREADY_VERIFIED') this.finish('already_verified');
        else this.error.set(commonErrorMessage(problem) ?? this.messages.errors.unexpected);
      }
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await work();
    } finally {
      this.busy.set(false);
    }
  }

  private finish(state: 'verified' | 'already_verified'): void {
    this.pending.clear();
    this.store.markEmailVerified();
    this.moveTo(state);
  }

  private moveTo(state: VerifyEmailState): void {
    this.state.set(state);
    focusAfterRender(() => this.stateMessage(), this.injector);
  }
}
