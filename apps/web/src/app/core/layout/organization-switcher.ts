import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatDivider } from '@angular/material/divider';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map } from 'rxjs';
import { MyOrganizationsStore } from '../organizations';
import { layoutMessages } from './layout.messages';

const ORGANIZATION_URL = /^\/o\/([^/?#]+)/;

/** Seletor de organização no cabeçalho (RF-04, CA-10): troca é só navegação para `/o/:slug`. */
@Component({
  selector: 'tf-organization-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDivider, MatMenu, MatMenuItem, MatMenuTrigger, RouterLink],
  template: `
    <button
      type="button"
      class="flex max-w-56 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-primary/25 focus-visible:outline-2 focus-visible:outline-focus"
      [matMenuTriggerFor]="menu"
      [attr.aria-label]="messages.open(current()?.name ?? null)"
    >
      <span class="truncate">{{ current()?.name ?? messages.label }}</span>
      <span aria-hidden="true">▾</span>
    </button>
    <mat-menu #menu="matMenu">
      @for (organization of store.items(); track organization.id) {
        <a
          mat-menu-item
          [routerLink]="['/o', organization.slug]"
          [attr.aria-current]="organization.slug === currentSlug() ? 'page' : null"
          >{{ organization.name }}</a
        >
      }
      @if (store.items().length > 0) {
        <mat-divider />
      }
      <a mat-menu-item routerLink="/organizations">{{ messages.all }}</a>
      <a mat-menu-item routerLink="/organizations/new">{{ messages.create }}</a>
    </mat-menu>
  `,
})
export class OrganizationSwitcher implements OnInit {
  protected readonly store = inject(MyOrganizationsStore);
  private readonly router = inject(Router);
  protected readonly messages = layoutMessages.organizationSwitcher;

  protected readonly currentSlug = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map(() => slugOf(this.router.url)),
    ),
    { initialValue: slugOf(this.router.url) },
  );
  protected readonly current = computed(
    () => this.store.items().find((item) => item.slug === this.currentSlug()) ?? null,
  );

  ngOnInit(): void {
    // Falha aqui não bloqueia nada: `/organizations` mostra o erro com nova tentativa.
    this.store.ensureLoaded().catch(() => undefined);
  }
}

function slugOf(url: string): string | null {
  const raw = ORGANIZATION_URL.exec(url)?.[1];
  return raw ? decodeURIComponent(raw) : null;
}
