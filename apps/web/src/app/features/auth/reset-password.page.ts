import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import type { PasswordRule } from '@taskflow/contracts';
import { AuthStore } from '../../core/auth';
import { toApiProblem } from '../../core/http/api-problem';
import { AccountApi } from './account-api';
import { AuthCard } from './auth-card';
import { authMessages, commonErrorMessage, passwordRulesFrom } from './auth.messages';
import { focusAfterRender, focusFirstInvalid } from './form-focus';
import { LinkToken } from './link-token';
import { passwordPolicyValidator } from './password-policy';
import { PasswordRequirements } from './password-requirements';

type ResetState = 'form' | 'done' | 'invalid_link';

/** RF-10 / BR-016. O token do link é lido uma vez, sai da URL e fica só neste componente. */
@Component({
  selector: 'tf-reset-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthCard,
    MatButton,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    MatSuffix,
    PasswordRequirements,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './reset-password.page.html',
})
export class ResetPasswordPage {
  private readonly api = inject(AccountApi);
  private readonly store = inject(AuthStore);
  private readonly injector = inject(Injector);
  private readonly token = inject(LinkToken).takeFromFragment();

  protected readonly messages = authMessages;
  protected readonly state = signal<ResetState>(this.token ? 'form' : 'invalid_link');
  protected readonly form = inject(FormBuilder).nonNullable.group({
    newPassword: ['', [Validators.required, passwordPolicyValidator]],
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly passwordVisible = signal(false);

  protected readonly password = toSignal(this.form.controls.newPassword.valueChanges, {
    initialValue: '',
  });
  private readonly rejected = signal<{ password: string; rules: PasswordRule[] } | null>(null);
  protected readonly serverViolations = computed(() => {
    const rejected = this.rejected();
    return rejected && rejected.password === this.password() ? rejected.rules : [];
  });

  private readonly passwordInput = viewChild<ElementRef<HTMLInputElement>>('passwordInput');
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');
  private readonly stateMessage = viewChild<ElementRef<HTMLElement>>('stateMessage');

  protected async submit(): Promise<void> {
    if (this.submitting() || !this.token) return;
    const control = this.form.controls.newPassword;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid([[control, this.passwordInput()]]);
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const newPassword = control.value;
    try {
      await this.api.resetPassword({ token: this.token, newPassword });
      // A API revogou todas as sessões (BR-016) e limpou os cookies deste navegador.
      this.store.endSession();
      this.moveTo('done');
    } catch (error) {
      const problem = toApiProblem(error);
      if (problem.code === 'INVALID_OR_EXPIRED_TOKEN' || problem.code === 'VALIDATION_FAILED') {
        this.moveTo('invalid_link');
      } else if (problem.code === 'PASSWORD_POLICY_VIOLATION') {
        const rules = passwordRulesFrom(problem.violations);
        this.rejected.set({ password: newPassword, rules });
        control.setErrors({ passwordPolicy: rules });
        this.error.set(this.messages.validation.passwordPolicy);
        focusAfterRender(() => this.errorAlert(), this.injector);
      } else {
        this.error.set(commonErrorMessage(problem) ?? this.messages.errors.unexpected);
        focusAfterRender(() => this.errorAlert(), this.injector);
      }
    } finally {
      this.submitting.set(false);
    }
  }

  private moveTo(state: ResetState): void {
    this.state.set(state);
    focusAfterRender(() => this.stateMessage(), this.injector);
  }
}
