import {
  ChangeDetectionStrategy,
  Component,
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
import { MatError, MatFormField, MatHint, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { Router } from '@angular/router';
import { AuthStore } from '../../core/auth';
import { toApiProblem } from '../../core/http/api-problem';
import { MyOrganizationsStore, OrganizationsApi } from '../../core/organizations';
import { focusAfterRender, focusFirstInvalid } from '../../shared/forms/form-focus';
import { commonErrorMessage, formMessages } from '../../shared/forms/form.messages';
import { createOrganizationMessages } from './organizations.messages';
import { isValidSlug, suggestSlug } from './slug';

/** Erros da API exibidos no próprio campo. */
const FIELD_ERRORS = {
  INVALID_SLUG: 'slug',
  SLUG_TAKEN: 'slug',
  INVALID_ORGANIZATION_NAME: 'name',
} as const;
type FieldError = keyof typeof FIELD_ERRORS;

function isFieldError(code: unknown): code is FieldError {
  return typeof code === 'string' && code in FIELD_ERRORS;
}

/** Onboarding `/organizations/new` (RF-01, CA-01, CA-02). */
@Component({
  selector: 'tf-create-organization-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatError, MatFormField, MatHint, MatInput, MatLabel, ReactiveFormsModule],
  template: `
    <section class="mx-auto max-w-xl px-4 py-10" aria-labelledby="create-title">
      <h1 id="create-title" class="text-2xl font-semibold tracking-tight">{{ messages.title }}</h1>
      <p class="mt-1 text-sm text-muted">{{ messages.intro }}</p>

      @if (auth.user()?.emailVerified === false) {
        <p
          class="mt-6 rounded-md bg-surface-muted px-4 py-3 text-sm"
          data-testid="unverified-notice"
        >
          {{ messages.unverified }}
        </p>
      }

      @if (error(); as message) {
        <p
          #errorAlert
          role="alert"
          tabindex="-1"
          class="mt-6 rounded-md bg-surface-muted px-4 py-3 text-sm text-error-text"
        >
          {{ message }}
        </p>
      }

      <form class="mt-6 flex flex-col gap-2" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <mat-form-field>
          <mat-label>{{ messages.name }}</mat-label>
          <input #nameInput matInput formControlName="name" autocomplete="organization" required />
          @if (form.controls.name.hasError('required') || form.controls.name.hasError('blank')) {
            <mat-error>{{ messages.validation.nameRequired }}</mat-error>
          } @else if (form.controls.name.hasError('length')) {
            <mat-error>{{ messages.validation.nameLength }}</mat-error>
          } @else if (serverMessage(form.controls.name); as message) {
            <mat-error>{{ message }}</mat-error>
          }
        </mat-form-field>

        <mat-form-field>
          <mat-label>{{ messages.slug }}</mat-label>
          <input
            #slugInput
            matInput
            formControlName="slug"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            required
            (input)="slugEdited.set(true)"
          />
          <mat-hint>{{ messages.slugHint(slug()) }}</mat-hint>
          @if (form.controls.slug.hasError('required')) {
            <mat-error>{{ messages.validation.slugRequired }}</mat-error>
          } @else if (form.controls.slug.hasError('format')) {
            <mat-error>{{ messages.validation.slugFormat }}</mat-error>
          } @else if (serverMessage(form.controls.slug); as message) {
            <mat-error>{{ message }}</mat-error>
          }
        </mat-form-field>

        <div class="mt-2">
          <button mat-flat-button type="submit" [disabled]="submitting()">
            {{ submitting() ? messages.submitting : messages.submit }}
          </button>
        </div>
      </form>
    </section>
  `,
})
export class CreateOrganizationPage {
  private readonly api = inject(OrganizationsApi);
  private readonly organizations = inject(MyOrganizationsStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  protected readonly auth = inject(AuthStore);
  protected readonly messages = createOrganizationMessages;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, notBlank, nameLength]],
    slug: ['', [Validators.required, slugFormat]],
  });
  protected readonly slug = toSignal(this.form.controls.slug.valueChanges, { initialValue: '' });
  /** Enquanto o usuário não edita o endereço, ele acompanha o nome. */
  protected readonly slugEdited = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly slugInput = viewChild<ElementRef<HTMLInputElement>>('slugInput');
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  constructor() {
    this.form.controls.name.valueChanges.pipe(takeUntilDestroyed()).subscribe((name) => {
      if (!this.slugEdited()) this.form.controls.slug.setValue(suggestSlug(name));
    });
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    const { controls } = this.form;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      focusFirstInvalid([
        [controls.name, this.nameInput()],
        [controls.slug, this.slugInput()],
      ]);
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const { name, slug } = this.form.getRawValue();
    try {
      const created = await this.api.create({ name, slug });
      this.organizations.add({
        id: created.id,
        name: created.name,
        slug: created.slug,
        role: created.myRole,
      });
      await this.router.navigate(['/o', created.slug]);
    } catch (error) {
      const problem = toApiProblem(error);
      this.showError(problem.code, commonErrorMessage(problem));
    } finally {
      this.submitting.set(false);
    }
  }

  protected serverMessage(control: AbstractControl): string | null {
    const code: unknown = control.getError('server');
    return isFieldError(code) ? this.messages.errors[code] : null;
  }

  private showError(code: string | null, common: string | null): void {
    const { controls } = this.form;
    if (isFieldError(code)) {
      const control = controls[FIELD_ERRORS[code]];
      // Erro do servidor no campo: some na próxima edição, quando os validadores rodam de novo.
      control.setErrors({ server: code });
      control.markAsTouched();
      focusFirstInvalid([
        [controls.name, this.nameInput()],
        [controls.slug, this.slugInput()],
      ]);
      return;
    }
    const specific =
      code === 'EMAIL_NOT_VERIFIED' || code === 'ORGANIZATION_LIMIT_REACHED'
        ? this.messages.errors[code]
        : null;
    this.error.set(specific ?? common ?? formMessages.errors.unexpected);
    focusAfterRender(() => this.errorAlert(), this.injector);
  }
}

function notBlank(control: AbstractControl<string>): ValidationErrors | null {
  return control.value.length > 0 && control.value.trim().length === 0 ? { blank: true } : null;
}

function nameLength(control: AbstractControl<string>): ValidationErrors | null {
  const length = [...control.value.trim()].length;
  return length > 0 && (length < 2 || length > 80) ? { length: true } : null;
}

function slugFormat(control: AbstractControl<string>): ValidationErrors | null {
  return control.value && !isValidSlug(control.value) ? { format: true } : null;
}
