import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Router } from '@angular/router';
import type { SessionSummary } from '@taskflow/contracts';
import { AuthStore } from '../../core/auth';
import { toApiProblem } from '../../core/http/api-problem';
import { commonErrorMessage } from '../../shared/forms/form.messages';
import { accountMessages, deviceLabel, formatDateTime } from './account.messages';
import {
  ACCOUNT_SECURITY_PATHS,
  AccountSecurityApi,
  parseSessionList,
} from './account-security-api';

/** Lista de sessões com revogação individual (CA-07). */
@Component({
  selector: 'tf-active-sessions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
  template: `
    @let m = messages.sessions;
    <p class="sr-only" aria-live="polite">{{ feedback() }}</p>
    @if (error(); as message) {
      <div
        role="alert"
        class="mb-3 rounded-md border border-error bg-surface-muted px-3 py-2 text-sm text-error-text"
      >
        {{ message }}
      </div>
    }
    @if (sessions.isLoading() && !sessions.hasValue()) {
      <p class="sr-only">{{ m.loading }}</p>
      <div class="space-y-3" aria-hidden="true" data-testid="sessions-skeleton">
        <div class="h-16 animate-pulse rounded-md bg-surface-muted"></div>
        <div class="h-16 animate-pulse rounded-md bg-surface-muted"></div>
      </div>
    } @else if (sessions.error() && !sessions.hasValue()) {
      <div role="alert" class="flex flex-col items-start gap-3">
        <p class="text-sm text-error-text">{{ m.loadFailed }}</p>
        <button matButton="outlined" type="button" (click)="sessions.reload()">
          {{ m.retry }}
        </button>
      </div>
    } @else {
      <ul class="divide-y divide-border" [attr.aria-label]="m.title" data-testid="sessions-list">
        @for (session of ordered(); track session.id) {
          <li
            class="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            [attr.data-session]="session.id"
          >
            <div class="min-w-0">
              <p class="flex flex-wrap items-center gap-2 font-medium">
                {{ device(session) }}
                @if (session.isCurrent) {
                  <span
                    class="rounded-sm bg-surface-muted px-2 py-0.5 text-xs font-medium text-success-text"
                    >{{ m.current }}</span
                  >
                }
              </p>
              <p class="text-sm text-muted">{{ m.lastUsedAt(date(session.lastUsedAt)) }}</p>
              <p class="text-sm text-muted">{{ m.createdAt(date(session.createdAt)) }}</p>
            </div>
            <button
              matButton="outlined"
              type="button"
              class="shrink-0"
              [disabled]="revoking() !== null"
              [attr.aria-label]="
                session.isCurrent ? null : m.revokeLabel(device(session), date(session.lastUsedAt))
              "
              (click)="revoke(session)"
            >
              @if (revoking() === session.id) {
                {{ m.revoking }}
              } @else {
                {{ session.isCurrent ? m.revokeCurrent : m.revoke }}
              }
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class ActiveSessions {
  private readonly api = inject(AccountSecurityApi);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);

  protected readonly messages = accountMessages;
  protected readonly sessions = httpResource(() => ACCOUNT_SECURITY_PATHS.sessions, {
    parse: parseSessionList,
  });
  /** Sessão atual primeiro; as demais pelo uso mais recente. */
  protected readonly ordered = computed(() =>
    [...(this.sessions.value()?.items ?? [])].sort(
      (a, b) =>
        Number(b.isCurrent) - Number(a.isCurrent) || b.lastUsedAt.localeCompare(a.lastUsedAt),
    ),
  );
  protected readonly revoking = signal<string | null>(null);
  protected readonly feedback = signal('');
  protected readonly error = signal<string | null>(null);

  protected readonly device = (session: SessionSummary) => deviceLabel(session.device);
  protected readonly date = formatDateTime;

  /** Recarrega após mudanças feitas fora da lista (ex.: troca de senha). */
  reload(): void {
    this.sessions.reload();
  }

  protected async revoke(session: SessionSummary): Promise<void> {
    if (this.revoking() !== null) return;
    this.revoking.set(session.id);
    this.error.set(null);
    try {
      await this.api.revokeSession(session.id);
      if (session.isCurrent) {
        // A API limpou os cookies deste navegador (mesmo efeito do logout).
        await this.store.afterSessionEnded();
        await this.router.navigateByUrl('/login');
        return;
      }
      this.feedback.set(this.messages.sessions.revoked);
      this.sessions.reload();
    } catch (error) {
      const problem = toApiProblem(error);
      // Já encerrada (por outra aba ou expiração): a lista só estava desatualizada.
      if (problem.code === 'SESSION_NOT_FOUND') this.sessions.reload();
      else this.error.set(commonErrorMessage(problem) ?? this.messages.sessions.revokeFailed);
    } finally {
      this.revoking.set(null);
    }
  }
}
