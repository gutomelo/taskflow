import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Router } from '@angular/router';
import type { MemberCandidate, ProjectMemberDto, ProjectRole } from '@taskflow/contracts';
import { AuthStore } from '../../core/auth';
import type { ApiProblem } from '../../core/http/api-problem';
import { ActiveOrganizationStore } from '../../core/organizations';
import { focusAfterRender } from '../../shared/forms/form-focus';
import { commonErrorMessage, formMessages } from '../../shared/forms/form.messages';
import { codeMessage } from '../organizations/organizations.messages';
import { ActiveProjectStore } from './active-project.store';
import { ProjectMembersStore } from './project-members.store';
import { isProjectRole } from './projects-contract-guards';
import { PROJECT_ROLE_LABELS, projectMembersMessages } from './projects.messages';

type Confirmation = Readonly<{ userId: string; kind: 'remove' | 'leave' }>;

/** Participantes do projeto (RF-06…RF-08): ações e candidatos vêm da API (sem regra local). */
@Component({
  selector: 'tf-project-members-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
  providers: [ProjectMembersStore],
  template: `
    <section class="mx-auto max-w-3xl px-4 py-6" aria-labelledby="project-members-title">
      <h2 id="project-members-title" class="text-lg font-semibold">{{ m.title }}</h2>
      <p class="mt-1 text-sm text-muted">{{ m.managersNote }}</p>
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

      @switch (store.status()) {
        @case ('loading') {
          <div class="mt-4 h-24 animate-pulse rounded-md bg-surface-muted" aria-hidden="true"></div>
          <p class="sr-only" role="status">{{ m.loading }}</p>
        }
        @case ('error') {
          <div class="mt-4">
            <p class="text-sm text-error-text">{{ m.loadFailed }}</p>
            <button matButton="outlined" type="button" class="mt-2" (click)="store.load()">
              {{ m.retry }}
            </button>
          </div>
        }
        @default {
          <ul
            class="mt-4 divide-y divide-border rounded-md border border-border"
            [attr.aria-label]="m.listLabel"
          >
            @for (member of store.items(); track member.userId) {
              <li class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p class="font-medium">{{ member.name ?? m.noName }}</p>
                  <p class="text-sm text-muted">{{ member.email }}</p>
                  @if (member.effectiveRole !== member.role) {
                    <p class="text-xs text-muted">
                      {{ m.effective(roles[member.effectiveRole].toLowerCase()) }}
                    </p>
                  }
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  @if (member.actions.changeRoleTo.length > 0) {
                    <select
                      class="rounded-md border border-border bg-surface px-2 py-1 text-sm"
                      [attr.aria-label]="m.roleLabel(member.name ?? m.noName)"
                      [value]="chosen(member)"
                      (change)="pick(member, $event)"
                    >
                      @for (role of rolesFor(member); track role) {
                        <option [value]="role" [selected]="role === chosen(member)">
                          {{ roles[role] }}
                        </option>
                      }
                    </select>
                    @if (chosen(member) !== member.role) {
                      <button
                        matButton="outlined"
                        type="button"
                        [disabled]="store.busy() !== null"
                        (click)="saveRole(member)"
                      >
                        {{ m.saveRole }}
                      </button>
                    }
                  } @else {
                    <span class="text-sm">{{ roles[member.role] }}</span>
                  }
                  @if (confirming()?.userId === member.userId) {
                    <span class="text-sm">{{
                      confirming()?.kind === 'leave'
                        ? m.confirmLeave
                        : m.confirmRemove(member.name ?? m.noName)
                    }}</span>
                    <button
                      #confirmButton
                      mat-flat-button
                      type="button"
                      [disabled]="store.busy() !== null"
                      (click)="confirm(member)"
                    >
                      {{ m.confirm }}
                    </button>
                    <button matButton type="button" (click)="confirming.set(null)">
                      {{ m.cancel }}
                    </button>
                  } @else if (member.actions.leave) {
                    <button matButton type="button" (click)="ask(member, 'leave')">
                      {{ m.leave }}
                    </button>
                  } @else if (member.actions.remove) {
                    <button
                      matButton
                      type="button"
                      [attr.aria-label]="m.removeLabel(member.name ?? m.noName)"
                      (click)="ask(member, 'remove')"
                    >
                      {{ m.remove }}
                    </button>
                  }
                </div>
              </li>
            }
          </ul>
          @if (store.hasMore()) {
            <button
              matButton="outlined"
              type="button"
              class="mt-3"
              [disabled]="store.loadingMore()"
              (click)="store.loadMore()"
            >
              {{ m.loadMore }}
            </button>
          }
        }
      }

      @if (canAdd()) {
        <div class="mt-8 rounded-md border border-border p-4">
          <h3 class="font-medium">{{ m.addTitle }}</h3>
          <p class="mt-1 text-sm text-muted">{{ m.addHint }}</p>
          @if (store.candidatesStatus() === 'loaded' && store.candidates().length === 0) {
            <p class="mt-3 text-sm text-muted">{{ m.noCandidates }}</p>
          } @else if (store.candidatesStatus() === 'loaded') {
            <div class="mt-3 flex flex-wrap items-end gap-2">
              <label class="flex flex-col text-sm">
                {{ m.person }}
                <select
                  class="rounded-md border border-border bg-surface px-2 py-1"
                  (change)="pickCandidate($event)"
                >
                  @for (option of store.candidates(); track option.userId) {
                    <option
                      [value]="option.userId"
                      [selected]="option.userId === candidate()?.userId"
                    >
                      {{ option.name ?? m.noName }} ({{ option.email }})
                    </option>
                  }
                </select>
              </label>
              <label class="flex flex-col text-sm">
                {{ m.role }}
                <select
                  class="rounded-md border border-border bg-surface px-2 py-1"
                  (change)="pickNewRole($event)"
                >
                  @for (role of candidate()?.allowedRoles ?? []; track role) {
                    <option [value]="role" [selected]="role === newRole()">
                      {{ roles[role] }}
                    </option>
                  }
                </select>
              </label>
              <button
                mat-flat-button
                type="button"
                [disabled]="store.busy() !== null || !candidate()"
                (click)="add()"
              >
                {{ m.add }}
              </button>
            </div>
            @if (store.hasMoreCandidates()) {
              <button matButton type="button" class="mt-2" (click)="store.loadCandidates(true)">
                {{ m.moreCandidates }}
              </button>
            }
          }
        </div>
      }
    </section>
  `,
})
export class ProjectMembersPage {
  protected readonly store = inject(ProjectMembersStore);
  private readonly project = inject(ActiveProjectStore);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  protected readonly m = projectMembersMessages;
  protected readonly roles = PROJECT_ROLE_LABELS;
  protected readonly error = signal<string | null>(null);
  protected readonly feedback = signal('');
  protected readonly confirming = signal<Confirmation | null>(null);
  private readonly picked = signal<Readonly<Record<string, ProjectRole>>>({});
  private readonly pickedCandidate = signal<string | null>(null);
  protected readonly newRole = signal<ProjectRole | null>(null);
  /** `project-member:manage` já vem descontado do arquivamento (BR-026). */
  protected readonly canAdd = computed(() => this.project.can('project-member:manage'));
  protected readonly candidate = computed<MemberCandidate | null>(() => {
    const candidates = this.store.candidates();
    return (
      candidates.find((item) => item.userId === this.pickedCandidate()) ?? candidates[0] ?? null
    );
  });
  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');
  // `read: ElementRef`: no `mat-flat-button` a referência é o componente, não o elemento.
  private readonly confirmButton = viewChild('confirmButton', { read: ElementRef });

  constructor() {
    void this.store.load();
    // Candidatos só para quem gerencia; recarrega se a capacidade mudar (papel alterado).
    effect(() => {
      if (this.canAdd()) untracked(() => void this.store.loadCandidates());
    });
    // O papel sugerido acompanha o candidato escolhido (só papéis que o teto permite).
    effect(() => {
      const allowed = this.candidate()?.allowedRoles ?? [];
      untracked(() => {
        const current = this.newRole();
        if (!current || !allowed.includes(current)) this.newRole.set(allowed.at(-1) ?? null);
      });
    });
  }

  protected rolesFor(member: ProjectMemberDto): ReadonlyArray<ProjectRole> {
    return [member.role, ...member.actions.changeRoleTo];
  }

  protected chosen(member: ProjectMemberDto): ProjectRole {
    return this.picked()[member.userId] ?? member.role;
  }

  protected pick(member: ProjectMemberDto, event: Event): void {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
    if (isProjectRole(value))
      this.picked.update((picked) => ({ ...picked, [member.userId]: value }));
  }

  protected pickCandidate(event: Event): void {
    this.pickedCandidate.set(event.target instanceof HTMLSelectElement ? event.target.value : null);
  }

  protected pickNewRole(event: Event): void {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
    if (isProjectRole(value)) this.newRole.set(value);
  }

  protected async add(): Promise<void> {
    const candidate = this.candidate();
    const role = this.newRole();
    if (!candidate || !role) return;
    this.error.set(null);
    const problem = await this.store.add(candidate, role);
    if (problem) return this.fail(problem);
    this.pickedCandidate.set(null);
    this.feedback.set(this.m.added(candidate.name ?? this.m.noName));
  }

  protected async saveRole(member: ProjectMemberDto): Promise<void> {
    const role = this.chosen(member);
    this.error.set(null);
    const problem = await this.store.changeRole(member, role);
    this.picked.update(({ [member.userId]: _, ...rest }) => rest);
    if (problem) return this.fail(problem);
    // O próprio papel mudou: capacidades e ações voltam da API (fonte única das regras).
    if (member.userId === this.auth.user()?.id) {
      await Promise.all([this.project.reload(), this.store.load()]);
    }
    this.feedback.set(
      this.m.roleChanged(member.name ?? this.m.noName, this.roles[role].toLowerCase()),
    );
  }

  protected ask(member: ProjectMemberDto, kind: Confirmation['kind']): void {
    this.confirming.set({ userId: member.userId, kind });
    focusAfterRender(() => this.confirmButton(), this.injector);
  }

  protected async confirm(member: ProjectMemberDto): Promise<void> {
    const kind = this.confirming()?.kind;
    this.confirming.set(null);
    this.error.set(null);
    const problem = await this.store.remove(member);
    if (problem) return this.fail(problem);
    if (kind === 'leave') {
      // Saiu: pode ter perdido o acesso ao projeto; a lista decide o que ainda vê.
      await this.router.navigate(['/o', this.organization.organization()?.slug, 'projects']);
      return;
    }
    this.feedback.set(this.m.removed(member.name ?? this.m.noName));
  }

  private async fail(problem: ApiProblem): Promise<void> {
    // BR-008 e dados que mudaram: mostra o estado atual antes de nova tentativa.
    if (problem.code === 'VERSION_CONFLICT' || problem.code === 'PROJECT_MEMBER_NOT_FOUND') {
      await this.store.load();
    }
    this.error.set(
      codeMessage(this.m.errors, problem.code) ??
        commonErrorMessage(problem) ??
        formMessages.errors.unexpected,
    );
    focusAfterRender(() => this.errorAlert(), this.injector);
  }
}
