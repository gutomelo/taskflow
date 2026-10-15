import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { MatError, MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { toApiProblem } from '../../core/http/api-problem';
import { ActiveOrganizationStore } from '../../core/organizations';
import { focusAfterRender } from '../../shared/forms/form-focus';
import { commonErrorMessage, formMessages } from '../../shared/forms/form.messages';
import { codeMessage } from '../organizations/organizations.messages';
import { ActiveProjectStore } from './active-project.store';
import { ProjectApi } from './project-api';
import { WorkflowSettings } from './workflow-settings';
import { projectSettingsMessages } from './projects.messages';

/** Configurações do projeto (RF-04, RF-05, BR-008, BR-026). */
@Component({
  selector: 'tf-project-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    WorkflowSettings,
    MatButton,
    MatError,
    MatFormField,
    MatInput,
    MatLabel,
    ReactiveFormsModule,
  ],
  template: `
    <section class="mx-auto max-w-xl px-4 py-6" aria-labelledby="project-settings-title">
      <h2 id="project-settings-title" class="text-lg font-semibold">{{ m.title }}</h2>
      @if (error(); as message) {
        <p
          #errorAlert
          role="alert"
          tabindex="-1"
          class="mt-4 rounded-md bg-surface-muted px-4 py-3 text-sm text-error-text"
        >
          {{ message }}
        </p>
      }
      <p class="mt-2 text-sm text-muted" aria-live="polite">{{ feedback() }}</p>

      @if (!store.can('project:update')) {
        <p class="mt-2 text-sm text-muted">{{ m.readOnly }}</p>
      }
      <form class="mt-4 flex flex-col gap-2" [formGroup]="form" (ngSubmit)="save()" novalidate>
        <mat-form-field>
          <mat-label>{{ m.name }}</mat-label>
          <input matInput formControlName="name" required />
          @if (form.controls.name.hasError('required')) {
            <mat-error>{{ m.validation.nameRequired }}</mat-error>
          } @else if (
            form.controls.name.hasError('minlength') || form.controls.name.hasError('maxlength')
          ) {
            <mat-error>{{ m.validation.nameLength }}</mat-error>
          }
        </mat-form-field>
        <mat-form-field>
          <mat-label>{{ m.description }}</mat-label>
          <textarea matInput formControlName="description" rows="4"></textarea>
          @if (form.controls.description.hasError('maxlength')) {
            <mat-error>{{ m.validation.descriptionLength }}</mat-error>
          }
        </mat-form-field>
        @if (store.can('project:update')) {
          <div>
            <button mat-flat-button type="submit" [disabled]="saving()">
              {{ saving() ? m.saving : m.save }}
            </button>
          </div>
        }
      </form>

      @if (store.can('project:archive')) {
        <div class="mt-10 rounded-md border border-border p-4">
          <h3 class="font-medium">{{ store.isArchived() ? m.restoreTitle : m.archiveTitle }}</h3>
          <p class="mt-1 text-sm text-muted">
            {{ store.isArchived() ? m.restoreBody : m.archiveBody }}
          </p>
          @if (store.isArchived()) {
            <button
              matButton="outlined"
              type="button"
              class="mt-3"
              [disabled]="saving()"
              (click)="setArchived(false)"
            >
              {{ m.restore }}
            </button>
          } @else if (confirmingArchive()) {
            <p class="mt-3 text-sm">{{ m.confirmArchive }}</p>
            <div class="mt-2 flex gap-2">
              <button
                #confirmButton
                mat-flat-button
                type="button"
                [disabled]="saving()"
                (click)="setArchived(true)"
              >
                {{ m.confirm }}
              </button>
              <button matButton type="button" (click)="confirmingArchive.set(false)">
                {{ m.cancel }}
              </button>
            </div>
          } @else {
            <button matButton="outlined" type="button" class="mt-3" (click)="askArchive()">
              {{ m.archive }}
            </button>
          }
        </div>
      }
    </section>
    @if (store.can('board:configure')) {
      <div class="mx-auto max-w-xl px-4 pb-10">
        <tf-workflow-settings />
      </div>
    }
  `,
})
export class ProjectSettingsPage {
  private readonly api = inject(ProjectApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly injector = inject(Injector);
  protected readonly store = inject(ActiveProjectStore);
  protected readonly m = projectSettingsMessages;
  protected readonly saving = signal(false);
  protected readonly feedback = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly confirmingArchive = signal(false);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    description: ['', [Validators.maxLength(2000)]],
  });
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');
  // `read: ElementRef`: no `mat-flat-button` a referência é o componente, não o elemento.
  private readonly confirmButton = viewChild('confirmButton', { read: ElementRef });

  constructor() {
    // O formulário mostra o projeto atual e só é editável com `project:update` (que a API já
    // nega em projeto arquivado): reage a recargas e a mudanças de capacidade.
    effect(() => {
      const project = this.store.project();
      const editable = this.store.can('project:update');
      untracked(() => {
        if (project)
          this.form.setValue({ name: project.name, description: project.description ?? '' });
        if (editable) this.form.enable();
        else this.form.disable();
      });
    });
  }

  protected async save(): Promise<void> {
    const project = this.store.project();
    if (!project || this.saving() || !this.store.can('project:update')) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { name, description } = this.form.getRawValue();
    await this.run(async () => {
      const updated = await this.api.update(this.organization.requireId(), project.id, {
        name,
        description: description.trim() === '' ? null : description,
        version: project.version,
      });
      this.store.replace(updated);
      this.feedback.set(this.m.saved);
    });
  }

  protected askArchive(): void {
    this.confirmingArchive.set(true);
    focusAfterRender(() => this.confirmButton(), this.injector);
  }

  protected async setArchived(archived: boolean): Promise<void> {
    const project = this.store.project();
    if (!project || this.saving()) return;
    this.confirmingArchive.set(false);
    await this.run(async () => {
      this.store.replace(
        await this.api.setArchived(this.organization.requireId(), project, archived),
      );
      this.feedback.set(archived ? this.m.archived : this.m.restored);
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.saving.set(true);
    this.error.set(null);
    this.feedback.set('');
    try {
      await work();
    } catch (error) {
      if (this.store.handle(error)) return;
      const problem = toApiProblem(error);
      // BR-008: outra pessoa alterou; mostra o estado atual antes de nova tentativa.
      if (problem.code === 'VERSION_CONFLICT' || problem.code === 'PROJECT_ARCHIVED') {
        await this.store.reload();
      }
      this.error.set(
        codeMessage(this.m.errors, problem.code) ??
          commonErrorMessage(problem) ??
          formMessages.errors.unexpected,
      );
      focusAfterRender(() => this.errorAlert(), this.injector);
    } finally {
      this.saving.set(false);
    }
  }
}
