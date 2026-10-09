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
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { toApiProblem } from '../../core/http/api-problem';
import { AccountApi } from './account-api';
import { AuthCard } from './auth-card';
import { authMessages, commonErrorMessage } from './auth.messages';
import { focusAfterRender, focusFirstInvalid } from './form-focus';

/** RF-10. A mesma resposta para qualquer e-mail válido: não revela se há conta (BR-014). */
@Component({
  selector: 'tf-forgot-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AuthCard,
    MatButton,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    ReactiveFormsModule,
    RouterLink,
  ],
  template: `
    @let m = messages.forgotPassword;
    @if (sentTo(); as email) {
      <tf-auth-card [heading]="m.sentTitle">
        <p
          #sentMessage
          tabindex="-1"
          role="status"
          class="text-sm focus:outline-none"
          data-testid="forgot-sent"
        >
          {{ m.sentBody(email) }}
        </p>
        <a matButton="filled" routerLink="/login" class="mt-6 w-full">{{ m.backToLogin }}</a>
      </tf-auth-card>
    } @else {
      <tf-auth-card [heading]="m.title" [subtitle]="m.subtitle">
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
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate class="flex flex-col gap-2">
          <mat-form-field appearance="outline">
            <mat-label>{{ messages.fields.email }}</mat-label>
            <input
              #emailInput
              matInput
              type="email"
              formControlName="email"
              autocomplete="email"
              inputmode="email"
              spellcheck="false"
              required
            />
            @if (form.controls.email.hasError('required')) {
              <mat-error>{{ messages.validation.emailRequired }}</mat-error>
            } @else if (form.controls.email.invalid) {
              <mat-error>{{ messages.validation.emailInvalid }}</mat-error>
            }
          </mat-form-field>
          <button matButton="filled" type="submit" class="mt-2" [disabled]="submitting()">
            {{ submitting() ? m.submitting : m.submit }}
          </button>
        </form>
        <p class="mt-6 text-center text-sm">
          <a
            routerLink="/login"
            class="font-medium text-primary underline-offset-2 hover:underline"
            >{{ m.backToLogin }}</a
          >
        </p>
      </tf-auth-card>
    }
  `,
})
export class ForgotPasswordPage {
  private readonly api = inject(AccountApi);
  private readonly injector = inject(Injector);

  protected readonly messages = authMessages;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email, Validators.maxLength(254)]],
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly sentTo = signal<string | null>(null);

  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');
  private readonly sentMessage = viewChild<ElementRef<HTMLElement>>('sentMessage');

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid([[this.form.controls.email, this.emailInput()]]);
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const email = this.form.controls.email.value.trim();
    try {
      await this.api.forgotPassword({ email });
      this.sentTo.set(email);
      focusAfterRender(() => this.sentMessage(), this.injector);
    } catch (error) {
      this.error.set(commonErrorMessage(toApiProblem(error)) ?? this.messages.errors.unexpected);
      focusAfterRender(() => this.errorAlert(), this.injector);
    } finally {
      this.submitting.set(false);
    }
  }
}
