import { DestroyRef, computed, inject, Injectable, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActiveOrganizationStore } from '../../core/organizations';
import { NotificationApi } from './notification-api';
import { notificationsMessages } from './notifications.messages';

/** Intervalo da consulta (decisão 4): 60 s, pausada com a aba oculta. */
export const UNREAD_POLL_MS = 60_000;

/**
 * Contador de não lidas da organização ativa (spec 008, RF-05). Provido na área da organização
 * (recriada por slug): consulta ao iniciar, a cada 60 s com a aba visível e ao voltar para a aba.
 * Falha mantém o último valor (o sino não pisca a cada queda de rede).
 */
@Injectable()
export class UnreadNotificationsStore {
  private readonly api = inject(NotificationApi);
  private readonly organization = inject(ActiveOrganizationStore);
  private readonly document = inject(DOCUMENT);
  private readonly state = signal({ count: 0, capped: false });
  private timer: ReturnType<typeof setInterval> | undefined;
  private started = false;

  readonly count = computed(() => this.state().count);
  readonly capped = computed(() => this.state().capped);
  /** Anúncio discreto quando o número aumenta (RNF-06). */
  readonly announcement = signal('');

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Começa a consultar; idempotente. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.document.addEventListener('visibilitychange', this.onVisibilityChange);
    if (!this.document.hidden) this.resume();
  }

  /** Consulta agora (ex.: depois de marcar como lida na página). */
  async refresh(): Promise<void> {
    const organizationId = this.organization.id();
    if (!organizationId) return;
    try {
      const next = await this.api.unreadCount(organizationId);
      const previous = this.state();
      if (next.count > previous.count || (next.capped && !previous.capped)) {
        this.announcement.set(notificationsMessages.arrived(next.count, next.capped));
      }
      this.state.set(next);
    } catch {
      // Contador é auxiliar: mantém o último valor e tenta na próxima consulta.
    }
  }

  /** Atualização local imediata (a próxima consulta confirma). */
  decrement(by = 1): void {
    this.state.update((state) =>
      state.capped ? state : { count: Math.max(0, state.count - by), capped: false },
    );
  }

  clear(): void {
    this.state.set({ count: 0, capped: false });
  }

  private readonly onVisibilityChange = () => {
    if (this.document.hidden) this.pause();
    else this.resume();
  };

  private resume(): void {
    this.pause();
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), UNREAD_POLL_MS);
  }

  private pause(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private stop(): void {
    this.pause();
    this.document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }
}
