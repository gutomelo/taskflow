import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import type { TaskDto, TaskPriority } from '@taskflow/contracts';
import { toApiProblem } from '../../core/http/api-problem';
import { ActiveOrganizationStore } from '../../core/organizations';
import { focusAfterRender } from '../../shared/forms/form-focus';
import { commonErrorMessage, formMessages } from '../../shared/forms/form.messages';
import { codeMessage } from '../organizations/organizations.messages';
import { TaskApi } from './task-api';
import { createTaskMessages, PRIORITY_LABELS } from './tasks.messages';

const PRIORITY_OPTIONS = Object.keys(PRIORITY_LABELS) as ReadonlyArray<TaskPriority>;

/**
 * "Nova tarefa" (RF-01; também subtarefa em RF-02 quando `parentTaskId` vem preenchido). O foco
 * vai para o título ao abrir; erros da API num alerta focável.
 */
@Component({
  selector: 'tf-create-task-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatError, MatFormField, MatInput, MatLabel, ReactiveFormsModule],
  template: `
    <form
      class="flex flex-col gap-2 rounded-md border border-border p-4"
      [formGroup]="form"
      (ngSubmit)="submit()"
      [attr.aria-label]="heading()"
      novalidate
    >
      @if (error(); as message) {
        <p #errorAlert role="alert" tabindex="-1" class="text-sm text-error-text">{{ message }}</p>
      }
      <mat-form-field>
        <mat-label>{{ m.taskTitle }}</mat-label>
        <input #titleInput matInput formControlName="title" autocomplete="off" required />
        @if (form.controls.title.hasError('required') || form.controls.title.hasError('blank')) {
          <mat-error>{{ m.validation.titleRequired }}</mat-error>
        } @else if (form.controls.title.hasError('maxlength')) {
          <mat-error>{{ m.validation.titleLength }}</mat-error>
        }
      </mat-form-field>
      <label class="flex flex-col gap-1 text-sm">
        {{ m.priority }}
        <select
          class="rounded-md border border-border bg-surface px-2 py-1"
          formControlName="priority"
        >
          @for (priority of priorities; track priority) {
            <option [value]="priority">{{ labels[priority] }}</option>
          }
        </select>
      </label>
      @if (parentTaskId()) {
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" formControlName="isRequired" />
          {{ requiredLabel() }}
        </label>
      }
      <div class="mt-2 flex gap-2">
        <button mat-flat-button type="submit" [disabled]="submitting()">
          {{ submitting() ? m.submitting : submitLabel() }}
        </button>
        <button matButton type="button" (click)="canceled.emit()">{{ m.cancel }}</button>
      </div>
    </form>
  `,
})
export class CreateTaskForm {
  private readonly api = inject(TaskApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly injector = inject(Injector);
  protected readonly m = createTaskMessages;
  protected readonly labels = PRIORITY_LABELS;
  protected readonly priorities = PRIORITY_OPTIONS;

  readonly projectId = input.required<string>();
  /** Preenchido ⇒ subtarefa (um nível, RF-02). */
  readonly parentTaskId = input<string | null>(null);
  readonly heading = input<string>(createTaskMessages.title);
  readonly submitLabel = input<string>(createTaskMessages.submit);
  readonly requiredLabel = input<string>('');
  readonly created = output<TaskDto>();
  readonly canceled = output<void>();
  /** Erros de projeto (404) que a página resolve (volta à lista de projetos). */
  readonly failed = output<unknown>();

  protected readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(200), notBlank]],
    priority: ['none' as TaskPriority],
    isRequired: [false],
  });
  protected readonly submitting = signal(false);
  protected readonly error = signal<string | null>(null);
  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  constructor() {
    focusAfterRender(() => this.titleInput(), this.injector);
  }

  protected async submit(): Promise<void> {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.titleInput()?.nativeElement.focus();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    const { title, priority, isRequired } = this.form.getRawValue();
    const parentTaskId = this.parentTaskId();
    try {
      const task = await this.api.create(this.organization.requireId(), {
        projectId: this.projectId(),
        title,
        priority,
        ...(parentTaskId ? { parentTaskId, isRequired } : {}),
      });
      this.form.reset();
      this.created.emit(task);
    } catch (error) {
      const problem = toApiProblem(error);
      if (problem.code === 'PROJECT_NOT_FOUND') {
        this.failed.emit(error);
        return;
      }
      this.error.set(
        commonErrorMessage(problem) ??
          codeMessage(this.m.errors, problem.code) ??
          formMessages.errors.unexpected,
      );
      focusAfterRender(() => this.errorAlert(), this.injector);
    } finally {
      this.submitting.set(false);
    }
  }
}

function notBlank(control: { value: unknown }) {
  return typeof control.value === 'string' && control.value.trim() === '' && control.value !== ''
    ? { blank: true }
    : null;
}
