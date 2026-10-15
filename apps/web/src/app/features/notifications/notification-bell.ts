import { ChangeDetectionStrategy, Component, computed, inject, type OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { notificationsMessages } from './notifications.messages';
import { UnreadNotificationsStore } from './unread-notifications.store';

/**
 * Sino da organização ativa (spec 008, RNF-06): link para a página de notificações com o
 * contador no nome acessível; o badge é só visual e o aumento é anunciado numa região `status`.
 */
@Component({
  selector: 'tf-notification-bell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <a
      routerLink="notifications"
      class="relative inline-flex items-center rounded-md px-2 py-2 text-muted hover:text-default focus-visible:outline-2 focus-visible:outline-focus"
      [attr.aria-label]="label()"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" class="size-5" fill="none">
        <path
          d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Zm4 4a2 2 0 0 0 4 0"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
      </svg>
      @if (store.count() > 0) {
        <span
          aria-hidden="true"
          data-testid="notification-badge"
          class="absolute -right-1 -top-0.5 min-w-5 rounded-full bg-primary px-1 text-center text-xs font-semibold leading-5 text-on-primary"
          >{{ badge() }}</span
        >
      }
    </a>
    <!-- role="status" (região viva "polite" implícita): anúncio discreto do aumento. -->
    <span class="sr-only" role="status" data-testid="notification-announcement">{{
      store.announcement()
    }}</span>
  `,
})
export class NotificationBell implements OnInit {
  protected readonly store = inject(UnreadNotificationsStore);
  protected readonly label = computed(() =>
    notificationsMessages.bell(this.store.count(), this.store.capped()),
  );
  protected readonly badge = computed(() =>
    notificationsMessages.badge(this.store.count(), this.store.capped()),
  );

  ngOnInit(): void {
    this.store.start();
  }
}
