import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import type { PasswordRule } from '@taskflow/contracts';
import { AuthStore } from '../../core/auth';
import { toApiProblem } from '../../core/http/api-problem';
import { focusAfterRender, focusFirstInvalid } from '../../shared/forms/form-focus';
import { commonErrorMessage } from '../../shared/forms/form.messages';
import { passwordPolicyValidatorFor } from '../../shared/password/password-policy';
import { PasswordRequirements } from '../../shared/password/password-requirements';
import { passwordRulesFrom } from '../../shared/password/password.messages';
import { accountMessages } from './account.messages';
import { AccountSecurityApi } from './account-security-api';

/** Troca de senha autenticada (CA-09, BR-016). */
@Component({
  selector: 'tf-change-password-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    PasswordRequirements,
    ReactiveFormsModule,
  ],
  template: `
    @let m = messages.changePassword;
    @if (error(); as message) {
      <div
        #errorAlert
        role="alert"
        tabindex="-1"
        class="mb-4 rounded-md border border-error bg-surface-muted px-3 py-2 text-sm text-error-text focus:outline-2 focus:outline-focus"
        data-testid="form-error"
      >
        {{ message }}
      </div>
    }
    <p
      #doneMessage
      tabindex="-1"
      role="status"
      class="text-sm text-success-text focus:outline-none"
      data-testid="password-changed"
    >
      {{ done() ? m.done : '' }}
    </p>
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="mt-2 flex flex-col gap-2">
      <mat-form-field appearance="outline">
        <mat-label>{{ m.currentPassword }}</mat-label>
        <input
          #currentInput
          matInput
          type="password"
          formControlName="currentPassword"
          autocomplete="current-password"
          required
        />
        @if (form.controls.currentPassword.hasError('incorrect')) {
          <mat-error>{{ m.currentIncorrect }}</mat-error>
        } @else if (form.controls.currentPassword.invalid) {
          <mat-error>{{ m.passwordRequired }}</mat-error>
        }
      </mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic">
        <mat-label>{{ m.newPassword }}</mat-label>
        <input
          #newInput
          matInput
          type="password"
          formControlName="newPassword"
          autocomplete="new-password"
          aria-describedby="new-password-requirements"
          required
        />
        @if (form.controls.newPassword.hasError('required')) {
          <mat-error>{{ m.passwordRequired }}</mat-error>
        } @else if (form.controls.newPassword.hasError('passwordPolicy')) {
          <mat-error>{{ m.passwordPolicy }}</mat-error>
        }
      </mat-form-field>
      <tf-password-requirements
        id="new-password-requirements"
        class="mb-2 block"
        [password]="newPassword()"
        [email]="email()"
        [serverViolations]="serverViolations()"
      />
      <button matButton="filled" type="submit" class="self-start" [disabled]="submitting()">
        {{ submitting() ? m.submitting : m.submit }}
      </button>
    </form>
  `,
})
export class ChangePasswordForm {
  private readonly api = inject(AccountSecurityApi);
  private readonly store = inject(AuthStore);
  private readonly injector = inject(Injector);
  /** Senha trocada: a lista de sessões precisa ser recarregada. */
  readonly changed = output<void>();

  protected readonly messages = accountMessages;
  protected readonly email = computed(() => this.store.user()?.email ?? '');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    currentPassword: ['', [Validators.required]],
    newPassword: ['', [Validators.required, passwordPolicyValidatorFor(() => this.email())]],
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal(false);
  protected readonly newPassword = toSignal(this.form.controls.newPassword.valueChanges, {
    initialValue: '',
  });
  private readonly rejected = signal<{ password: string; rules: PasswordRule[] } | null>(null);
  protected readonly serverViolations = computed(() => {
    const rejected = this.rejected();
    return rejected && rejected.password === this.newPassword() ? rejected.rules : [];
  });

  private readonly currentInput = viewChild<ElementRef<HTMLInputElement>>('currentInput');
  private readonly newInput = viewChild<ElementRef<HTMLInputElement>>('newInput');
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');
  private readonly doneMessage = viewChild<ElementRef<HTMLElement>>('doneMessage');

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    const { controls } = this.form;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid([
        [controls.currentPassword, this.currentInput()],
        [controls.newPassword, this.newInput()],
      ]);
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    this.done.set(false);
    const request = this.form.getRawValue();
    try {
      // A API devolve novos cookies de sessão e CSRF; as outras sessões são revogadas.
      await this.api.changePassword(request);
      this.form.reset();
      this.done.set(true);
      this.changed.emit();
      focusAfterRender(() => this.doneMessage(), this.injector);
    } catch (error) {
      const problem = toApiProblem(error);
      if (problem.code === 'CURRENT_PASSWORD_INCORRECT') {
        controls.currentPassword.setErrors({ incorrect: true });
        controls.currentPassword.markAsTouched();
        focusAfterRender(() => this.currentInput(), this.injector);
        return;
      }
      if (problem.code === 'PASSWORD_POLICY_VIOLATION') {
        const rules = passwordRulesFrom(problem.violations);
        this.rejected.set({ password: request.newPassword, rules });
        controls.newPassword.setErrors({ passwordPolicy: rules });
        this.error.set(this.messages.changePassword.passwordPolicy);
      } else {
        this.error.set(commonErrorMessage(problem) ?? this.messages.errors.unexpected);
      }
      focusAfterRender(() => this.errorAlert(), this.injector);
    } finally {
      this.submitting.set(false);
    }
  }
}
