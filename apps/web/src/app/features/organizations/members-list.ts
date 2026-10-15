import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { MatButton } from '@angular/material/button';
import { Router } from '@angular/router';
import type { Member, OrganizationRole } from '@taskflow/contracts';
import { AuthStore } from '../../core/auth';
import type { ApiProblem } from '../../core/http/api-problem';
import {
  ActiveOrganizationStore,
  isOrganizationRole,
  MyOrganizationsStore,
} from '../../core/organizations';
import { focusAfterRender } from '../../shared/forms/form-focus';
import { commonErrorMessage, formMessages } from '../../shared/forms/form.messages';
import { MembersStore } from './members.store';
import { codeMessage, formatDate, membersMessages, ROLE_LABELS } from './organizations.messages';

type Confirmation = Readonly<{ userId: string; kind: 'remove' | 'leave' }>;

/** Lista de membros com papel, remoção e saída (RF-09…RF-12, CA-07, CA-08). */
@Component({
  selector: 'tf-members-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton],
  providers: [MembersStore],
  template: `
    @let m = messages;
    <p class="sr-only" aria-live="polite">{{ feedback() }}</p>
    @if (error(); as message) {
      <p
        #errorAlert
        role="alert"
        tabindex="-1"
        class="mb-3 rounded-md border border-error bg-surface-muted px-3 py-2 text-sm text-error-text"
      >
        {{ message }}
      </p>
    }
    @switch (store.status()) {
      @case ('loading') {
        <p class="sr-only">{{ m.loading }}</p>
        <div class="space-y-3" aria-hidden="true" data-testid="members-skeleton">
          <div class="h-16 animate-pulse rounded-md bg-surface-muted"></div>
          <div class="h-16 animate-pulse rounded-md bg-surface-muted"></div>
        </div>
      }
      @case ('error') {
        <div role="alert" class="flex flex-col items-start gap-3">
          <p class="text-sm text-error-text">{{ m.loadFailed }}</p>
          <button matButton="outlined" type="button" (click)="store.load()">{{ m.retry }}</button>
        </div>
      }
      @default {
        <ul class="divide-y divide-border" [attr.aria-label]="m.listLabel">
          @for (member of store.items(); track member.userId) {
            @let name = member.name ?? m.noName;
            @let self = member.userId === auth.user()?.id;
            <li class="flex flex-col gap-3 py-4 md:flex-row md:items-center md:justify-between">
              <div class="min-w-0">
                <p class="font-medium">
                  {{ name }}
                  @if (self) {
                    <span class="text-sm font-normal text-muted">({{ m.you }})</span>
                  }
                </p>
                @if (member.email) {
                  <p class="truncate text-sm text-muted">{{ member.email }}</p>
                }
                <p class="text-sm text-muted">{{ m.joinedAt(date(member.joinedAt)) }}</p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                @if (rolesFor(member).length > 1) {
                  <label class="sr-only" [for]="'role-' + member.userId">{{
                    m.roleLabel(name)
                  }}</label>
                  <select
                    [id]="'role-' + member.userId"
                    class="rounded-md border border-border bg-surface px-2 py-1.5 text-sm"
                    (change)="pick(member, $event)"
                  >
                    @for (role of rolesFor(member); track role) {
                      <option [value]="role" [selected]="role === chosen(member)">
                        {{ roles[role] }}
                      </option>
                    }
                  </select>
                  <button
                    matButton="outlined"
                    type="button"
                    [disabled]="chosen(member) === member.role || store.busy() !== null"
                    (click)="saveRole(member)"
                  >
                    {{ m.saveRole }}
                  </button>
                } @else {
                  <span class="text-sm">{{ roles[member.role] }}</span>
                }
                @if (confirming()?.userId === member.userId) {
                  <span class="text-sm">{{
                    confirming()?.kind === 'leave' ? m.confirmLeave : m.confirmRemove(name)
                  }}</span>
                  <button #confirmButton matButton="filled" type="button" (click)="confirm(member)">
                    {{ m.confirm }}
                  </button>
                  <button matButton type="button" (click)="confirming.set(null)">
                    {{ m.cancel }}
                  </button>
                } @else if (self) {
                  <button matButton="outlined" type="button" (click)="ask(member, 'leave')">
                    {{ m.leave }}
                  </button>
                } @else if (member.actions.remove) {
                  <button
                    matButton="outlined"
                    type="button"
                    [attr.aria-label]="m.removeLabel(name)"
                    [disabled]="store.busy() !== null"
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
            class="mt-4"
            [disabled]="store.loadingMore()"
            (click)="loadMore()"
          >
            {{ m.loadMore }}
          </button>
        }
      }
    }
  `,
})
export class MembersList implements OnInit {
  protected readonly store = inject(MembersStore);
  protected readonly auth = inject(AuthStore);
  private readonly active = inject(ActiveOrganizationStore);
  private readonly organizations = inject(MyOrganizationsStore);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  protected readonly messages = membersMessages;
  protected readonly roles = ROLE_LABELS;
  protected readonly date = formatDate;
  protected readonly feedback = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly confirming = signal<Confirmation | null>(null);
  private readonly picked = signal<Readonly<Record<string, OrganizationRole>>>({});

  private readonly errorAlert = viewChild<ElementRef<HTMLElement>>('errorAlert');
  private readonly confirmButton = viewChild('confirmButton', { read: ElementRef });

  ngOnInit(): void {
    void this.store.load();
  }

  /** Papel atual + os permitidos pela API (`actions`, spec 006); sem matriz no frontend. */
  protected rolesFor(member: Member): ReadonlyArray<OrganizationRole> {
    return [member.role, ...member.actions.changeRoleTo];
  }

  protected chosen(member: Member): OrganizationRole {
    return this.picked()[member.userId] ?? member.role;
  }

  protected pick(member: Member, event: Event): void {
    const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
    if (isOrganizationRole(value))
      this.picked.update((picked) => ({ ...picked, [member.userId]: value }));
  }

  protected async saveRole(member: Member): Promise<void> {
    const role = this.chosen(member);
    this.error.set(null);
    const problem = await this.store.changeRole(member, role);
    this.picked.update(({ [member.userId]: _, ...rest }) => rest);
    if (problem) return this.fail(problem);
    // O próprio papel mudou: capacidades da organização e ações sobre os outros membros mudam;
    // ambas voltam da API (fonte única das regras). Se as capacidades não voltarem, a área da
    // organização deixa de confiar nas antigas (`ActiveOrganizationStore.can`) e o usuário é avisado.
    if (member.userId === this.auth.user()?.id) {
      await Promise.all([
        this.organizations
          .reload()
          .catch(() => this.error.set(this.messages.capabilitiesReloadFailed)),
        this.store.load(),
      ]);
    }
    this.feedback.set(
      this.messages.roleChanged(
        member.name ?? this.messages.noName,
        ROLE_LABELS[role].toLowerCase(),
      ),
    );
  }

  protected ask(member: Member, kind: Confirmation['kind']): void {
    this.confirming.set({ userId: member.userId, kind });
    focusAfterRender(() => this.confirmButton(), this.injector);
  }

  protected async confirm(member: Member): Promise<void> {
    const kind = this.confirming()?.kind;
    this.confirming.set(null);
    this.error.set(null);
    const problem = await this.store.remove(member);
    if (problem) return this.fail(problem);
    if (kind === 'leave') {
      // Saiu: a organização some da lista e a área deixa de ser acessível (CA-09).
      this.organizations.invalidate();
      await this.router.navigateByUrl('/organizations');
      return;
    }
    this.feedback.set(this.messages.removed(member.name ?? this.messages.noName));
  }

  protected async loadMore(): Promise<void> {
    try {
      await this.store.loadMore();
    } catch {
      this.error.set(this.messages.loadFailed);
    }
  }

  private fail(problem: ApiProblem): void {
    this.error.set(
      codeMessage(this.messages.errors, problem.code) ??
        commonErrorMessage(problem) ??
        formMessages.errors.unexpected,
    );
    focusAfterRender(() => this.errorAlert(), this.injector);
  }
}
