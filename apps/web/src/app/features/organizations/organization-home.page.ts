import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthStore } from '../../core/auth';
import { ActiveOrganizationStore } from '../../core/organizations';
import { organizationMessages, ROLE_LABELS } from './organizations.messages';

/** Início da organização (`/o/:slug`). */
@Component({
  selector: 'tf-organization-home-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <section class="mx-auto max-w-3xl px-4 py-10" aria-labelledby="home-title">
      <h1 id="home-title" class="text-2xl font-semibold tracking-tight">
        {{ messages.greeting(auth.user()?.name ?? '') }}
      </h1>
      <p class="mt-1 text-sm text-muted">{{ youAreIn() }}</p>
      <ul class="mt-8 grid gap-4 sm:grid-cols-2">
        <li>
          <a
            routerLink="/account/security"
            class="block h-full rounded-lg border border-border bg-surface p-5 shadow-sm hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span class="font-medium">{{ messages.securityTitle }}</span>
            <span class="mt-1 block text-sm text-muted">{{ messages.securityBody }}</span>
          </a>
        </li>
        <li>
          <a
            routerLink="/status"
            class="block h-full rounded-lg border border-border bg-surface p-5 shadow-sm hover:border-border-strong focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span class="font-medium">{{ messages.statusTitle }}</span>
            <span class="mt-1 block text-sm text-muted">{{ messages.statusBody }}</span>
          </a>
        </li>
      </ul>
    </section>
  `,
})
export class OrganizationHomePage {
  protected readonly auth = inject(AuthStore);
  private readonly active = inject(ActiveOrganizationStore);
  protected readonly messages = organizationMessages;
  protected readonly youAreIn = computed(() => {
    const organization = this.active.organization();
    return organization
      ? organizationMessages.youAreIn(
          organization.name,
          ROLE_LABELS[organization.role].toLowerCase(),
        )
      : '';
  });
}
