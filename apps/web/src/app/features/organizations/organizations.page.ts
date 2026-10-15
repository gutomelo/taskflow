import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MyOrganizationsStore } from '../../core/organizations';
import { organizationListMessages, ROLE_LABELS } from './organizations.messages';

/** `/organizations` (RF-02, CA-10): minhas organizações; destino de "não encontrada". */
@Component({
  selector: 'tf-organizations-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="mx-auto max-w-3xl px-4 py-10" aria-labelledby="organizations-title">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="organizations-title" class="text-2xl font-semibold tracking-tight">
            {{ messages.title }}
          </h1>
          <p class="mt-1 text-sm text-muted">{{ messages.intro }}</p>
        </div>
        <a
          routerLink="/organizations/new"
          class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary focus-visible:outline-2 focus-visible:outline-focus"
          >{{ messages.create }}</a
        >
      </div>

      @if (notFound) {
        <p role="alert" class="mt-6 rounded-md bg-surface-muted px-4 py-3 text-sm">
          {{ messages.notFound }}
        </p>
      }

      @switch (store.status()) {
        @case ('error') {
          <div role="alert" class="mt-6 text-sm text-error-text">
            {{ messages.loadFailed }}
            <button type="button" class="ms-2 underline" (click)="retry()">
              {{ messages.retry }}
            </button>
          </div>
        }
        @case ('loaded') {
          @if (store.items().length === 0) {
            <p class="mt-8 text-sm">{{ messages.empty }}</p>
          } @else {
            <ul class="mt-8 grid gap-3" [attr.aria-label]="messages.listLabel">
              @for (organization of store.items(); track organization.id) {
                <li>
                  <a
                    [routerLink]="['/o', organization.slug]"
                    class="flex items-center justify-between rounded-lg border border-border bg-surface p-4 shadow-sm hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus"
                  >
                    <span class="font-medium">{{ organization.name }}</span>
                    <span class="text-sm text-muted">{{ roles[organization.role] }}</span>
                  </a>
                </li>
              }
            </ul>
          }
          <p class="mt-6 text-sm text-muted">{{ messages.invitationHint }}</p>
        }
        @default {
          <p class="mt-8 text-sm text-muted" role="status">{{ messages.loading }}</p>
        }
      }
    </section>
  `,
})
export class OrganizationsPage implements OnInit {
  protected readonly store = inject(MyOrganizationsStore);
  protected readonly messages = organizationListMessages;
  protected readonly roles = ROLE_LABELS;
  /** Vindo de `/o/:slug` sem acesso (resolver ou 404 de uma chamada). */
  protected readonly notFound =
    inject(Router).currentNavigation()?.extras.state?.['organizationNotFound'] === true;

  ngOnInit(): void {
    this.store.ensureLoaded().catch(() => undefined);
  }

  protected retry(): void {
    this.store.reload().catch(() => undefined);
  }
}
