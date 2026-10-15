import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { NotificationDto } from '@taskflow/contracts';
import { ActiveOrganizationStore } from '../../core/organizations';
import { absoluteTime, relativeTime } from '../tasks/comments/comment-body';
import { NotificationApi } from './notification-api';
import { notificationsMessages } from './notifications.messages';
import { UnreadNotificationsStore } from './unread-notifications.store';

type Status = 'loading' | 'loaded' | 'error';

/** Caminho da tarefa a partir da chave `PROJ-N` (relativo à área da organização). */
export function taskLink(key: string): string[] {
  const dash = key.lastIndexOf('-');
  return ['..', 'projects', key.slice(0, dash), 'tasks', key.slice(dash + 1)];
}

/**
 * Página de notificações da organização ativa (spec 008, RF-04 e RF-06): mais recentes primeiro,
 * "carregar mais" (páginas podem vir curtas), abrir marca como lida e leva à tarefa, "marcar todas"
 * até a mais recente exibida.
 */
@Component({
  selector: 'tf-notifications-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="mx-auto max-w-3xl px-4 py-8">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">{{ messages.title }}</h1>
          <p class="mt-1 text-sm text-muted">{{ messages.subtitle }}</p>
        </div>
        @if (hasUnread()) {
          <button
            type="button"
            class="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-60"
            [disabled]="busy()"
            (click)="markAllRead()"
          >
            {{ messages.markAllRead }}
          </button>
        }
      </div>

      <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
      @if (error()) {
        <p role="alert" class="mt-4 text-sm text-error-text">{{ error() }}</p>
      }

      @switch (status()) {
        @case ('loading') {
          <p class="mt-8 text-sm text-muted" role="status">{{ messages.loading }}</p>
        }
        @case ('error') {
          <div class="mt-8" role="alert">
            <p class="text-sm text-error-text">{{ messages.loadFailed }}</p>
            <button
              type="button"
              class="mt-2 text-sm font-medium text-primary underline focus-visible:outline-2 focus-visible:outline-focus"
              (click)="load()"
            >
              {{ messages.retry }}
            </button>
          </div>
        }
        @default {
          @if (items().length === 0) {
            <p class="mt-8 text-sm text-muted">{{ messages.empty }}</p>
          } @else {
            <ul class="mt-6 divide-y divide-border rounded-lg border border-border bg-surface">
              @for (item of items(); track item.id) {
                <li [class.bg-surface-muted]="item.readAt === null">
                  <a
                    [routerLink]="link(item)"
                    class="flex items-start gap-3 px-4 py-3 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus"
                    (click)="open(item)"
                  >
                    @if (item.readAt === null) {
                      <span
                        aria-hidden="true"
                        class="mt-2 size-2 shrink-0 rounded-full bg-primary"
                      ></span>
                      <span class="sr-only">{{ messages.unread }}:</span>
                    } @else {
                      <span aria-hidden="true" class="mt-2 size-2 shrink-0"></span>
                    }
                    <span class="min-w-0 flex-1 text-sm">
                      <span class="font-medium">{{
                        item.actor.name ?? messages.formerMember
                      }}</span>
                      {{ messages.phrase(item.kind) }}
                      <span class="font-mono">{{ item.task.key }}</span>
                      <span class="block truncate text-muted">{{ item.task.title }}</span>
                    </span>
                    <time
                      class="shrink-0 text-xs text-muted"
                      [attr.datetime]="item.occurredAt"
                      [attr.title]="absolute(item.occurredAt)"
                      >{{ relative(item.occurredAt) }}</time
                    >
                  </a>
                </li>
              }
            </ul>
          }
          @if (nextCursor() !== null) {
            <button
              type="button"
              class="mt-4 text-sm font-medium text-primary underline focus-visible:outline-2 focus-visible:outline-focus"
              [disabled]="busy()"
              (click)="loadMore()"
            >
              {{ messages.loadMore }}
            </button>
          }
        }
      }
    </div>
  `,
})
export class NotificationsPage {
  private readonly api = inject(NotificationApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly unread = inject(UnreadNotificationsStore);
  protected readonly messages = notificationsMessages;
  protected readonly status = signal<Status>('loading');
  protected readonly items = signal<ReadonlyArray<NotificationDto>>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly announcement = signal('');
  protected readonly hasUnread = computed(() => this.items().some((item) => item.readAt === null));
  private readonly now = new Date();

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.status.set('loading');
    try {
      const page = await this.api.page(this.organization.requireId(), null);
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.status.set('loaded');
    } catch {
      this.status.set('error');
    }
  }

  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (cursor === null) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      const page = await this.api.page(this.organization.requireId(), cursor);
      this.items.update((items) => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch {
      this.error.set(this.messages.loadFailed);
    } finally {
      this.busy.set(false);
    }
  }

  protected link(item: NotificationDto): string[] {
    return taskLink(item.task.key);
  }

  /** Marca como lida sem segurar a navegação: a falha só deixa a notificação não lida. */
  protected open(item: NotificationDto): void {
    if (item.readAt !== null) return;
    const organizationId = this.organization.requireId();
    this.unread.decrement();
    this.api.markRead(organizationId, item.id).then(
      () => undefined,
      () => void this.unread.refresh(),
    );
  }

  protected async markAllRead(): Promise<void> {
    const newest = this.items()[0];
    if (!newest) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.markAllRead(this.organization.requireId(), newest.id);
      const readAt = new Date().toISOString();
      this.items.update((items) =>
        items.map((item) => (item.readAt === null ? { ...item, readAt } : item)),
      );
      this.announcement.set(this.messages.markedAllRead);
      await this.unread.refresh();
    } catch {
      this.error.set(this.messages.actionFailed);
    } finally {
      this.busy.set(false);
    }
  }

  protected relative(iso: string): string {
    return relativeTime(iso, this.now);
  }

  protected absolute(iso: string): string {
    return absoluteTime(iso);
  }
}
