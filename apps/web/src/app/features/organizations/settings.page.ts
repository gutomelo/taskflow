import {
  ChangeDetectionStrategy,
  Component,
  effect,
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
import type { OrganizationDto } from '@taskflow/contracts';
import { toApiProblem } from '../../core/http/api-problem';
import { ActiveOrganizationStore, MyOrganizationsStore } from '../../core/organizations';
import { focusAfterRender } from '../../shared/forms/form-focus';
import { commonErrorMessage, formMessages } from '../../shared/forms/form.messages';
import { OrganizationApi } from './organization-api';
import { codeMessage, settingsMessages } from './organizations.messages';

/** `/o/:slug/settings` (RF-05): renomear com BR-008; o slug é fixo (BR-022). */
@Component({
  selector: 'tf-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, MatError, MatFormField, MatInput, MatLabel, ReactiveFormsModule],
  template: `
    @let m = messages;
    <section class="mx-auto max-w-xl px-4 py-10" aria-labelledby="settings-title">
      <h1 id="settings-title" class="text-2xl font-semibold tracking-tight">{{ m.title }}</h1>
      <p class="sr-only" aria-live="polite">{{ feedback() }}</p>
      @if (error(); as message) {
        <p
          #errorAlert
          role="alert"
          tabindex="-1"
          class="mt-4 rounded-md border border-error bg-surface-muted px-3 py-2 text-sm text-error-text"
        >
          {{ message }}
        </p>
      }
      @if (organization(); as organization) {
        <form
          class="mt-6 flex flex-col gap-2"
          [formGroup]="form"
          (ngSubmit)="save(organization)"
          novalidate
        >
          <mat-form-field>
            <mat-label>{{ m.name }}</mat-label>
            <input
              matInput
              formControlName="name"
              required
              [readonly]="!active.can('organization:update')"
            />
            @if (form.controls.name.invalid) {
              <mat-error>{{ m.errors.INVALID_ORGANIZATION_NAME }}</mat-error>
            }
          </mat-form-field>
          <p class="text-sm text-muted">
            <span class="font-medium">{{ m.slug }}:</span> {{ m.slugFixed(organization.slug) }}
          </p>
          <div class="mt-4 flex items-start gap-3">
            <input
              id="members-can-create-projects"
              type="checkbox"
              class="mt-1 size-4"
              formControlName="membersCanCreateProjects"
              aria-describedby="members-can-create-projects-hint"
            />
            <div>
              <label for="members-can-create-projects" class="font-medium">{{
                m.membersCanCreateProjects
              }}</label>
              <p id="members-can-create-projects-hint" class="text-sm text-muted">
                {{ m.membersCanCreateProjectsHint }}
              </p>
            </div>
          </div>
          @if (active.can('organization:update')) {
            <div class="mt-2">
              <button mat-flat-button type="submit" [disabled]="saving()">
                {{ saving() ? m.saving : m.save }}
              </button>
            </div>
          } @else {
            <p class="text-sm text-muted">{{ m.readOnly }}</p>
          }
        </form>
      } @else if (loadFailed()) {
        <div role="alert" class="mt-6 flex flex-col items-start gap-3">
          <p class="text-sm text-error-text">{{ m.loadFailed }}</p>
          <button matButton="outlined" type="button" (click)="load()">{{ m.retry }}</button>
        </div>
      } @else {
        <div class="mt-6 h-24 animate-pulse rounded-md bg-surface-muted" aria-hidden="true"></div>
      }
    </section>
  `,
})
export class SettingsPage implements OnInit {
  private readonly api = inject(OrganizationApi);
  private readonly organizations = inject(MyOrganizationsStore);
  private readonly injector = inject(Injector);
  protected readonly active = inject(ActiveOrganizationStore);
  protected readonly messages = settingsMessages;

  protected readonly organization = signal<OrganizationDto | null>(null);
  protected readonly loadFailed = signal(false);
  protected readonly saving = signal(false);
  protected readonly feedback = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
    membersCanCreateProjects: [true],
  });
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');

  constructor() {
    // Sem `organization:update` a opção só é exibida (a API negaria a alteração). Reage às
    // capacidades: o papel pode mudar com a página aberta.
    effect(() => {
      const control = this.form.controls.membersCanCreateProjects;
      if (this.active.can('organization:update')) control.enable();
      else control.disable();
    });
  }

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      this.show(await this.api.get(this.active.requireId()));
    } catch {
      this.loadFailed.set(true);
    }
  }

  protected async save(organization: OrganizationDto): Promise<void> {
    if (this.saving() || !this.active.can('organization:update')) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set(null);
    try {
      const { name, membersCanCreateProjects } = this.form.getRawValue();
      const renamed = await this.api.update(organization.id, {
        name: name.trim(),
        membersCanCreateProjects,
        version: organization.version,
      });
      this.show(renamed);
      this.organizations.add({
        id: renamed.id,
        name: renamed.name,
        slug: renamed.slug,
        role: renamed.myRole,
        capabilities: renamed.capabilities,
      });
      this.feedback.set(this.messages.saved);
    } catch (error) {
      const problem = toApiProblem(error);
      // BR-008: outra pessoa alterou; mostra o estado atual antes de nova tentativa.
      if (problem.code === 'VERSION_CONFLICT') await this.load();
      this.error.set(
        codeMessage(this.messages.errors, problem.code) ??
          commonErrorMessage(problem) ??
          formMessages.errors.unexpected,
      );
      focusAfterRender(() => this.errorAlert(), this.injector);
    } finally {
      this.saving.set(false);
    }
  }

  private show(organization: OrganizationDto): void {
    this.organization.set(organization);
    this.form.setValue({
      name: organization.name,
      membersCanCreateProjects: organization.membersCanCreateProjects,
    });
  }
}
