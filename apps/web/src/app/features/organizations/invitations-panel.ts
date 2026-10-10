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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import type { InvitableRole, InvitationDto } from '@taskflow/contracts';
import type { ApiProblem } from '../../core/http/api-problem';
import { focusAfterRender, focusFirstInvalid } from '../../shared/forms/form-focus';
import { commonErrorMessage, formMessages } from '../../shared/forms/form.messages';
import { InvitationsStore } from './invitations.store';
import {
  codeMessage,
  formatDate,
  invitationsMessages,
  ROLE_LABELS,
} from './organizations.messages';

const INVITABLE: ReadonlyArray<InvitableRole> = ['admin', 'member', 'viewer'];
const DEFAULT_ROLE: InvitableRole = 'member';

/** Convites (RF-06, RF-07, CA-06, CA-12): convidar, reenviar e revogar. Só owner/admin. */
@Component({
  selector: 'tf-invitations-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatError, MatFormField, MatInput, MatLabel, ReactiveFormsModule],
  providers: [InvitationsStore],
  template: `
    @let m = messages;
    <p class="text-sm text-muted">{{ m.intro }}</p>
    <p class="sr-only" aria-live="polite">{{ feedback() }}</p>
    @if (error(); as message) {
      <p
        #errorAlert
        role="alert"
        tabindex="-1"
        class="mt-3 rounded-md border border-error bg-surface-muted px-3 py-2 text-sm text-error-text"
      >
        {{ message }}
      </p>
    }
    <form
      class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start"
      [formGroup]="form"
      (ngSubmit)="invite()"
      novalidate
    >
      <mat-form-field class="flex-1">
        <mat-label>{{ m.email }}</mat-label>
        <input
          #emailInput
          matInput
          type="email"
          formControlName="email"
          autocomplete="off"
          required
        />
        @if (form.controls.email.hasError('required')) {
          <mat-error>{{ m.validation.emailRequired }}</mat-error>
        } @else if (form.controls.email.invalid) {
          <mat-error>{{ m.validation.emailInvalid }}</mat-error>
        }
      </mat-form-field>
      <div class="flex flex-col">
        <label for="invite-role" class="text-sm">{{ m.role }}</label>
        <select
          id="invite-role"
          formControlName="role"
          class="rounded-md border border-border bg-surface px-2 py-2 text-sm"
        >
          @for (role of invitable; track role) {
            <option [value]="role">{{ roles[role] }}</option>
          }
        </select>
      </div>
      <button mat-flat-button type="submit" class="sm:mt-5" [disabled]="inviting()">
        {{ inviting() ? m.inviting : m.invite }}
      </button>
    </form>

    @switch (store.status()) {
      @case ('loading') {
        <div class="mt-4 h-12 animate-pulse rounded-md bg-surface-muted" aria-hidden="true"></div>
      }
      @case ('error') {
        <div role="alert" class="mt-4 flex flex-col items-start gap-3">
          <p class="text-sm text-error-text">{{ m.loadFailed }}</p>
          <button matButton="outlined" type="button" (click)="store.load()">{{ m.retry }}</button>
        </div>
      }
      @default {
        @if (store.items().length === 0) {
          <p class="mt-4 text-sm text-muted">{{ m.empty }}</p>
        } @else {
          <ul class="mt-4 divide-y divide-border" [attr.aria-label]="m.listLabel">
            @for (invitation of store.items(); track invitation.id) {
              <li class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
                <div class="min-w-0">
                  <p class="truncate font-medium">{{ invitation.email }}</p>
                  <p class="text-sm text-muted">
                    {{ roles[invitation.role] }} · {{ m.invitedBy(invitation.invitedBy.name) }} ·
                    @if (invitation.status === 'expired') {
                      <span class="text-error-text">{{ m.expired }}</span>
                    } @else {
                      {{ m.expiresAt(date(invitation.expiresAt)) }}
                    }
                  </p>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  @if (confirming() === invitation.id) {
                    <span class="text-sm">{{ m.confirmRevoke(invitation.email) }}</span>
                    <button
                      #confirmButton
                      matButton="filled"
                      type="button"
                      (click)="revoke(invitation)"
                    >
                      {{ m.confirm }}
                    </button>
                    <button matButton type="button" (click)="confirming.set(null)">
                      {{ m.cancel }}
                    </button>
                  } @else {
                    <button
                      matButton="outlined"
                      type="button"
                      [attr.aria-label]="m.resendLabel(invitation.email)"
                      [disabled]="store.busy() !== null"
                      (click)="resend(invitation)"
                    >
                      {{ m.resend }}
                    </button>
                    <button
                      matButton="outlined"
                      type="button"
                      [attr.aria-label]="m.revokeLabel(invitation.email)"
                      [disabled]="store.busy() !== null"
                      (click)="ask(invitation)"
                    >
                      {{ m.revoke }}
                    </button>
                  }
                </div>
              </li>
            }
          </ul>
          @if (store.hasMore()) {
            <button
              matButton="outlined"
              type="button"
              class="mt-4"
              [disabled]="store.loadingMore()"
              (click)="loadMore()"
            >
              {{ m.loadMore }}
            </button>
          }
        }
      }
    }
  `,
})
export class InvitationsPanel implements OnInit {
  protected readonly store = inject(InvitationsStore);
  private readonly injector = inject(Injector);
  protected readonly messages = invitationsMessages;
  protected readonly roles = ROLE_LABELS;
  protected readonly invitable = INVITABLE;
  protected readonly date = formatDate;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    role: [DEFAULT_ROLE, Validators.required],
  });
  protected readonly inviting = signal(false);
  protected readonly feedback = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly confirming = signal<string | null>(null);

  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');
  private readonly confirmButton = viewChild('confirmButton', { read: ElementRef });

  ngOnInit(): void {
    void this.store.load();
  }

  protected async invite(): Promise<void> {
    if (this.inviting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid([[this.form.controls.email, this.emailInput()]]);
      return;
    }
    this.inviting.set(true);
    this.error.set(null);
    const { email, role } = this.form.getRawValue();
    try {
      const result = await this.store.invite(email.trim(), role);
      if ('problem' in result) return this.fail(result.problem);
      const target = result.invitation.email;
      this.feedback.set(
        result.created ? this.messages.invited(target) : this.messages.reinvited(target),
      );
      this.form.reset({ email: '', role: DEFAULT_ROLE });
    } finally {
      this.inviting.set(false);
    }
  }

  protected async resend(invitation: InvitationDto): Promise<void> {
    this.error.set(null);
    const problem = await this.store.resend(invitation);
    if (problem) return this.fail(problem);
    this.feedback.set(this.messages.resent(invitation.email));
  }

  protected async loadMore(): Promise<void> {
    try {
      await this.store.loadMore();
    } catch {
      this.error.set(this.messages.loadFailed);
    }
  }

  protected ask(invitation: InvitationDto): void {
    this.confirming.set(invitation.id);
    focusAfterRender(() => this.confirmButton(), this.injector);
  }

  protected async revoke(invitation: InvitationDto): Promise<void> {
    this.confirming.set(null);
    this.error.set(null);
    const problem = await this.store.revoke(invitation);
    if (problem) return this.fail(problem);
    this.feedback.set(this.messages.revoked(invitation.email));
  }

  private fail(problem: ApiProblem): void {
    this.error.set(
      codeMessage(this.messages.errors, problem.code) ??
        commonErrorMessage(problem) ??
        formMessages.errors.unexpected,
    );
    focusAfterRender(() => this.errorAlert(), this.injector);
  }
}
