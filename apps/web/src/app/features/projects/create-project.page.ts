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
import { Router, RouterLink } from '@angular/router';
import { toApiProblem } from '../../core/http/api-problem';
import { ActiveOrganizationStore } from '../../core/organizations';
import { focusAfterRender, focusFirstInvalid } from '../../shared/forms/form-focus';
import { commonErrorMessage, formMessages } from '../../shared/forms/form.messages';
import { codeMessage } from '../organizations/organizations.messages';
import { ProjectApi } from './project-api';
import { isValidProjectKey, normalizeTypedKey, suggestProjectKey } from './project-key';
import { createProjectMessages } from './projects.messages';

/** Erros da API exibidos no próprio campo. */
const FIELD_ERRORS = {
  INVALID_PROJECT_KEY: 'key',
  PROJECT_KEY_TAKEN: 'key',
  INVALID_PROJECT_NAME: 'name',
  INVALID_PROJECT_DESCRIPTION: 'description',
} as const;
type FieldError = keyof typeof FIELD_ERRORS;

function isFieldError(code: unknown): code is FieldError {
  return typeof code === 'string' && Object.hasOwn(FIELD_ERRORS, code);
}

/** Criação de projeto `/o/:slug/projects/new` (RF-01, RF-11, BR-025). */
@Component({
  selector: 'tf-create-project-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButton,
    MatError,
    MatFormField,
    MatHint,
    MatInput,
    MatLabel,
    ReactiveFormsModule,
    RouterLink,
  ],
  template: `
    <section class="mx-auto max-w-xl px-4 py-10" aria-labelledby="create-project-title">
      <h1 id="create-project-title" class="text-2xl font-semibold tracking-tight">{{ m.title }}</h1>
      <p class="mt-1 text-sm text-muted">{{ m.intro }}</p>

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
          <mat-label>{{ m.name }}</mat-label>
          <input #nameInput matInput formControlName="name" autocomplete="off" required />
          @if (form.controls.name.hasError('required') || form.controls.name.hasError('blank')) {
            <mat-error>{{ m.validation.nameRequired }}</mat-error>
          } @else if (form.controls.name.hasError('length')) {
            <mat-error>{{ m.validation.nameLength }}</mat-error>
          } @else if (serverMessage(form.controls.name); as message) {
            <mat-error>{{ message }}</mat-error>
          }
        </mat-form-field>

        <mat-form-field>
          <mat-label>{{ m.key }}</mat-label>
          <input
            #keyInput
            matInput
            formControlName="key"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            required
            maxlength="10"
            (input)="typedKey($event)"
          />
          <mat-hint>{{ m.keyHint(key()) }}</mat-hint>
          @if (form.controls.key.hasError('required')) {
            <mat-error>{{ m.validation.keyRequired }}</mat-error>
          } @else if (form.controls.key.hasError('format')) {
            <mat-error>{{ m.validation.keyFormat }}</mat-error>
          } @else if (serverMessage(form.controls.key); as message) {
            <mat-error>{{ message }}</mat-error>
          }
        </mat-form-field>

        <mat-form-field>
          <mat-label>{{ m.description }}</mat-label>
          <textarea #descriptionInput matInput formControlName="description" rows="4"></textarea>
          @if (form.controls.description.hasError('maxlength')) {
            <mat-error>{{ m.validation.descriptionLength }}</mat-error>
          } @else if (serverMessage(form.controls.description); as message) {
            <mat-error>{{ message }}</mat-error>
          }
        </mat-form-field>

        <div class="mt-2 flex gap-2">
          <button mat-flat-button type="submit" [disabled]="submitting()">
            {{ submitting() ? m.submitting : m.submit }}
          </button>
          <a matButton routerLink="..">{{ m.cancel }}</a>
        </div>
      </form>
    </section>
  `,
})
export class CreateProjectPage {
  private readonly api = inject(ProjectApi);
  private readonly active = inject(ActiveOrganizationStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  protected readonly m = createProjectMessages;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, notBlank, nameLength]],
    key: ['', [Validators.required, keyFormat]],
    description: ['', [Validators.maxLength(2000)]],
  });
  protected readonly key = toSignal(this.form.controls.key.valueChanges, { initialValue: '' });
  /** Enquanto o usuário não edita a chave, ela acompanha o nome. */
  private readonly keyEdited = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly keyInput = viewChild<ElementRef<HTMLInputElement>>('keyInput');
  private readonly descriptionInput =
    viewChild<ElementRef<HTMLTextAreaElement>>('descriptionInput');
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  constructor() {
    this.form.controls.name.valueChanges.pipe(takeUntilDestroyed()).subscribe((name) => {
      if (!this.keyEdited()) this.form.controls.key.setValue(suggestProjectKey(name));
    });
  }

  /** Maiúsculas sem acento ao digitar (a API não converte o que recebe). */
  protected typedKey(event: Event): void {
    this.keyEdited.set(true);
    const value = event.target instanceof HTMLInputElement ? event.target.value : '';
    const normalized = normalizeTypedKey(value);
    if (normalized !== value) this.form.controls.key.setValue(normalized);
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.focusInvalid();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const { name, key, description } = this.form.getRawValue();
    try {
      const created = await this.api.create(this.active.requireId(), {
        name,
        key,
        description: description.trim() === '' ? null : description,
      });
      await this.router.navigate(['/o', this.active.organization()?.slug, 'projects', created.key]);
    } catch (error) {
      const problem = toApiProblem(error);
      this.showError(problem.code, commonErrorMessage(problem));
    } finally {
      this.submitting.set(false);
    }
  }

  protected serverMessage(control: AbstractControl): string | null {
    const code: unknown = control.getError('server');
    return isFieldError(code) ? this.m.errors[code] : null;
  }

  private focusInvalid(): void {
    const { controls } = this.form;
    focusFirstInvalid([
      [controls.name, this.nameInput()],
      [controls.key, this.keyInput()],
      [controls.description, this.descriptionInput()],
    ]);
  }

  private showError(code: string | null, common: string | null): void {
    if (isFieldError(code)) {
      const control = this.form.controls[FIELD_ERRORS[code]];
      // Erro do servidor no campo: some na próxima edição, quando os validadores rodam de novo.
      control.setErrors({ server: code });
      control.markAsTouched();
      this.focusInvalid();
      return;
    }
    this.error.set(codeMessage(this.m.errors, code) ?? common ?? formMessages.errors.unexpected);
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

function keyFormat(control: AbstractControl<string>): ValidationErrors | null {
  return control.value && !isValidProjectKey(control.value) ? { format: true } : null;
}
