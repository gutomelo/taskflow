import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel, MatSuffix } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthApi, AuthStore, safeReturnUrl } from '../../core/auth';
import { toApiProblem } from '../../core/http/api-problem';
import { AuthCard } from './auth-card';
import { authMessages, commonErrorMessage } from './auth.messages';
import { focusAfterRender, focusFirstInvalid } from './form-focus';

@Component({
  selector: 'tf-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthCard,
    MatButton,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    MatSuffix,
    ReactiveFormsModule,
    RouterLink,
  ],
  templateUrl: './login.page.html',
})
export class LoginPage {
  private readonly api = inject(AuthApi);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);

  protected readonly messages = authMessages;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
    password: ['', [Validators.required, Validators.maxLength(1024)]],
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly passwordVisible = signal(false);

  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
  private readonly passwordInput = viewChild<ElementRef<HTMLInputElement>>('passwordInput');
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid([
        [this.form.controls.email, this.emailInput()],
        [this.form.controls.password, this.passwordInput()],
      ]);
      return;
    }

    this.submitting.set(true);
    this.error.set(null);
    try {
      const user = await this.api.login(this.form.getRawValue());
      this.store.signIn(user);
      await this.router.navigateByUrl(
        safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')),
      );
    } catch (error) {
      const problem = toApiProblem(error);
      this.error.set(
        problem.code === 'INVALID_CREDENTIALS'
          ? this.messages.login.invalidCredentials
          : (commonErrorMessage(problem) ?? this.messages.errors.unexpected),
      );
      // Sem dizer qual campo errou (não enumerar contas); a senha é limpa para nova tentativa.
      this.form.controls.password.reset();
      focusAfterRender(() => this.errorAlert(), this.injector);
    } finally {
      this.submitting.set(false);
    }
  }
}
