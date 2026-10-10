import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import type { InvitationPreview } from '@taskflow/contracts';
import { AuthApi, AuthStore } from '../../core/auth';
import { toApiProblem } from '../../core/http/api-problem';
import { MyOrganizationsStore, OrganizationsApi } from '../../core/organizations';
import { focusAfterRender } from '../../shared/forms/form-focus';
import { commonErrorMessage, formMessages } from '../../shared/forms/form.messages';
import { LinkToken } from '../../shared/links/link-token';
import { acceptInvitationMessages, formatDate, ROLE_LABELS } from './organizations.messages';
import { PendingInvitation } from './pending-invitation';

export type AcceptState =
  | 'no_token'
  | 'needs_login'
  | 'loading'
  | 'ready'
  | 'needs_verification'
  | 'wrong_account'
  | 'already_member'
  | 'invalid'
  | 'lookup_failed';

/**
 * `/invitations/accept` (RF-08, CA-04, CA-05, BR-020). O token sai da URL na hora e fica só em
 * memória; a prévia (`lookup`) não consome nada; o aceite exige clique.
 */
@Component({
  selector: 'tf-accept-invitation-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, RouterLink],
  template: `
    @let m = messages;
    <section class="mx-auto max-w-xl px-4 py-10" aria-labelledby="accept-title">
      <h1 id="accept-title" class="text-2xl font-semibold tracking-tight">{{ m.title }}</h1>
      @if (error(); as message) {
        <p
          role="alert"
          class="mt-4 rounded-md border border-error bg-surface-muted px-3 py-2 text-sm text-error-text"
        >
          {{ message }}
        </p>
      }
      <div
        #stateMessage
        tabindex="-1"
        class="mt-6 flex flex-col items-start gap-4 focus:outline-none"
        data-testid="accept-state"
        [attr.data-state]="state()"
      >
        @switch (state()) {
          @case ('no_token') {
            <p>{{ m.noToken }}</p>
          }
          @case ('needs_login') {
            <p>{{ m.needsLogin }}</p>
            <div class="flex flex-wrap gap-2">
              <a mat-flat-button routerLink="/login" [queryParams]="returnHere">{{ m.signIn }}</a>
              <a matButton="outlined" routerLink="/register" [queryParams]="returnHere">{{
                m.register
              }}</a>
              <button matButton type="button" [disabled]="busy()" (click)="recheckSession()">
                {{ m.checkAgain }}
              </button>
            </div>
          }
          @case ('lookup_failed') {
            <button matButton="outlined" type="button" (click)="retry()">{{ m.retry }}</button>
          }
          @case ('loading') {
            <p role="status">{{ m.loading }}</p>
          }
          @case ('invalid') {
            <p>{{ m.invalid }}</p>
            <a matButton="outlined" routerLink="/organizations">{{ m.goToOrganizations }}</a>
          }
          @case ('already_member') {
            <p>{{ m.alreadyMember }}</p>
            <a matButton="outlined" routerLink="/organizations">{{ m.goToOrganizations }}</a>
          }
          @default {
            @if (preview(); as invitation) {
              <p class="text-lg">{{ describe(invitation) }}</p>
              <p class="text-sm text-muted">{{ m.validUntil(date(invitation.expiresAt)) }}</p>
              @switch (state()) {
                @case ('wrong_account') {
                  <p>{{ m.wrongAccount(invitation.maskedEmail) }}</p>
                }
                @case ('needs_verification') {
                  <p>{{ m.needsVerification }}</p>
                  <button
                    matButton="outlined"
                    type="button"
                    [disabled]="busy()"
                    (click)="recheckSession()"
                  >
                    {{ m.verifiedNow }}
                  </button>
                }
                @default {
                  <button mat-flat-button type="button" [disabled]="busy()" (click)="accept()">
                    {{ busy() ? m.accepting : m.accept }}
                  </button>
                }
              }
            }
          }
        }
      </div>
    </section>
  `,
})
export class AcceptInvitationPage implements OnInit {
  private readonly api = inject(OrganizationsApi);
  private readonly authApi = inject(AuthApi);
  private readonly auth = inject(AuthStore);
  private readonly organizations = inject(MyOrganizationsStore);
  private readonly pending = inject(PendingInvitation);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  protected readonly messages = acceptInvitationMessages;
  protected readonly date = formatDate;
  protected readonly returnHere = { returnUrl: '/invitations/accept' };
  protected readonly state = signal<AcceptState>('no_token');
  protected readonly preview = signal<InvitationPreview | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly stateMessage = viewChild<ElementRef<HTMLElement>>('stateMessage');

  constructor() {
    const fromLink = inject(LinkToken).takeFromFragment();
    if (fromLink) this.pending.remember(fromLink);
  }

  ngOnInit(): void {
    void this.evaluate();
  }

  protected describe(invitation: InvitationPreview): string {
    return this.messages.invitation(
      invitation.invitedByName,
      invitation.organizationName,
      ROLE_LABELS[invitation.role].toLowerCase(),
    );
  }

  /** Sessão aberta ou e-mail confirmado em outra aba (cookies compartilhados): relê o `/me`. */
  protected async recheckSession(): Promise<void> {
    this.busy.set(true);
    try {
      this.auth.signIn(await this.authApi.currentUser());
    } catch {
      // Continua sem sessão: o estado atual já orienta a entrar.
    } finally {
      this.busy.set(false);
    }
    await this.evaluate();
  }

  protected async accept(): Promise<void> {
    const token = this.pending.current();
    if (!token || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const organization = await this.api.acceptInvitation(token);
      this.pending.clear();
      this.organizations.add(organization);
      await this.router.navigate(['/o', organization.slug]);
    } catch (error) {
      const problem = toApiProblem(error);
      switch (problem.code) {
        case 'EMAIL_NOT_VERIFIED':
          return this.moveTo('needs_verification');
        // O convite continua válido para a conta certa: o token fica guardado.
        case 'INVITATION_FOR_ANOTHER_ACCOUNT':
          return this.moveTo('wrong_account');
        case 'ALREADY_A_MEMBER':
          this.pending.clear();
          return this.moveTo('already_member');
        case 'INVALID_OR_EXPIRED_INVITATION':
        case 'VALIDATION_FAILED':
          this.pending.clear();
          return this.moveTo('invalid');
        case 'ORGANIZATION_LIMIT_REACHED':
          this.error.set(this.messages.limitReached);
          return;
        default:
          this.error.set(commonErrorMessage(problem) ?? formMessages.errors.unexpected);
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected retry(): void {
    this.error.set(null);
    void this.evaluate();
  }

  private async evaluate(): Promise<void> {
    const token = this.pending.current();
    if (!token) return this.moveTo('no_token');
    const user = this.auth.user();
    if (!user) return this.moveTo('needs_login');
    this.state.set('loading');
    try {
      const preview = await this.api.lookupInvitation(token);
      this.preview.set(preview);
      if (!preview.isForCurrentUser) return this.moveTo('wrong_account');
      this.moveTo(user.emailVerified ? 'ready' : 'needs_verification');
    } catch (error) {
      const problem = toApiProblem(error);
      if (
        problem.code === 'INVALID_OR_EXPIRED_INVITATION' ||
        problem.code === 'VALIDATION_FAILED'
      ) {
        this.pending.clear();
        return this.moveTo('invalid');
      }
      // Rede ou serviço: o token continua guardado para nova tentativa.
      this.error.set(commonErrorMessage(problem) ?? formMessages.errors.unexpected);
      this.moveTo('lookup_failed');
    }
  }

  private moveTo(state: AcceptState): void {
    this.state.set(state);
    focusAfterRender(() => this.stateMessage(), this.injector);
  }
}
