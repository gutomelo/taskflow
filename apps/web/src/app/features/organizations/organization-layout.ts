import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { ActiveOrganizationStore, isMyOrganization } from '../../core/organizations';
import { organizationMessages } from './organizations.messages';

/**
 * Área `/o/:slug` (RF-04). Recebe a organização do resolver e provê o `ActiveOrganizationStore`
 * para as páginas filhas, que montam as URLs da API com o id dela (ADR 0012).
 */
@Component({
  selector: 'tf-organization-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  providers: [ActiveOrganizationStore],
  template: `
    <nav class="border-b border-border bg-surface" [attr.aria-label]="messages.sectionNav">
      <ul class="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
        @for (link of links; track link.path) {
          <li>
            <a
              [routerLink]="link.path"
              routerLinkActive="border-primary text-default"
              [routerLinkActiveOptions]="{ exact: true }"
              ariaCurrentWhenActive="page"
              class="inline-block border-b-2 border-transparent px-3 py-3 text-sm text-muted hover:text-default focus-visible:outline-2 focus-visible:outline-focus"
            >
              {{ link.label }}
            </a>
          </li>
        }
      </ul>
    </nav>
    <router-outlet />
  `,
})
export class OrganizationLayout {
  /** Resolvida por `organizationResolver` antes da ativação (já disponível no construtor). */
  private readonly organization = toSignal(
    inject(ActivatedRoute).data.pipe(
      map((data) => {
        const organization: unknown = data['organization'];
        return isMyOrganization(organization) ? organization : null;
      }),
    ),
    { initialValue: null },
  );
  protected readonly messages = organizationMessages;
  protected readonly links: ReadonlyArray<{ path: string; label: string }> = [
    { path: '.', label: organizationMessages.home },
    { path: 'members', label: organizationMessages.members },
    { path: 'settings', label: organizationMessages.settings },
  ];

  constructor() {
    inject(ActiveOrganizationStore).connect(this.organization);
  }
}
