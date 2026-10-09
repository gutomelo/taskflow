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
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import type { FieldViolation, PasswordRule } from '@taskflow/contracts';
import { AuthApi } from '../../core/auth';
import { toApiProblem } from '../../core/http/api-problem';
import { AuthCard } from './auth-card';
import { authMessages, commonErrorMessage, isPasswordRule } from './auth.messages';
import { focusAfterRender, focusFirstInvalid } from './form-focus';
import { unmetPasswordRules } from './password-policy';
import { PasswordRequirements } from './password-requirements';

@Component({
  selector: 'tf-register-page',
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
  templateUrl: './register.page.html',
})
export class RegisterPage {
  private readonly api = inject(AuthApi);
  private readonly injector = inject(Injector);

  protected readonly messages = authMessages;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100), notBlank]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', [Validators.required, passwordPolicy]],
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly passwordVisible = signal(false);
  /** E-mail enviado com sucesso; a tela passa a mostrar a confirmação. */
  protected readonly submittedEmail = signal<string | null>(null);

  protected readonly password = toSignal(this.form.controls.password.valueChanges, {
    initialValue: '',
  });
  protected readonly email = toSignal(this.form.controls.email.valueChanges, { initialValue: '' });
  /** Regras recusadas pelo servidor, válidas apenas para a senha que foi enviada. */
  private readonly rejected = signal<{ password: string; rules: PasswordRule[] } | null>(null);
  protected readonly serverViolations = computed(() => {
    const rejected = this.rejected();
    return rejected && rejected.password === this.password() ? rejected.rules : [];
  });

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
  private readonly passwordInput = viewChild<ElementRef<HTMLInputElement>>('passwordInput');
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');
  private readonly successHeading = viewChild<ElementRef<HTMLElement>>('successHeading');

  constructor() {
    // `same_as_email` depende do e-mail: a senha é revalidada quando ele muda.
    this.form.controls.email.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.form.controls.password.updateValueAndValidity());
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    const { controls } = this.form;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid([
        [controls.name, this.nameInput()],
        [controls.email, this.emailInput()],
        [controls.password, this.passwordInput()],
      ]);
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    const request = this.form.getRawValue();
    try {
      await this.api.register(request);
      this.submittedEmail.set(request.email.trim());
      focusAfterRender(() => this.successHeading(), this.injector);
    } catch (error) {
      const problem = toApiProblem(error);
      if (problem.code === 'PASSWORD_POLICY_VIOLATION') {
        const rules = rulesFrom(problem.violations);
        this.rejected.set({ password: request.password, rules });
        // Erro manual: some na próxima edição, quando os validadores rodam de novo.
        controls.password.setErrors({ passwordPolicy: rules });
        this.error.set(this.messages.validation.passwordPolicy);
      } else {
        this.error.set(commonErrorMessage(problem) ?? this.messages.errors.unexpected);
      }
      focusAfterRender(() => this.errorAlert(), this.injector);
    } finally {
      this.submitting.set(false);
    }
  }
}

function notBlank(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.length > 0 && control.value.trim().length === 0 ? { blank: true } : null;
}

/** BR-011 no cliente; o e-mail vem do formulário pai para a regra `same_as_email`. */
function passwordPolicy(control: AbstractControl<string>): ValidationErrors | null {
  if (control.value.length === 0) return null; // `required` cuida do vazio
  const email: unknown = control.parent?.get('email')?.value;
  const unmet = unmetPasswordRules(control.value, typeof email === 'string' ? email : '');
  return unmet.length > 0 ? { passwordPolicy: unmet } : null;
}

function rulesFrom(violations: ReadonlyArray<FieldViolation>): PasswordRule[] {
  return violations
    .filter((violation) => violation.field === 'password')
    .flatMap((violation) => {
      const rule = violation.message;
      return isPasswordRule(rule) ? [rule] : [];
    });
}
