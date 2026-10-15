import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { NotificationPage, NotificationPreference, UnreadCount } from '@taskflow/contracts';
import { ContractViolationError } from '../../core/http/contract-guards';
import { tenantUrl } from '../../core/organizations';
import {
  isNotificationPage,
  isNotificationPreference,
  isUnreadCount,
} from './notifications-contract-guards';

function checked<T>(body: unknown, guard: (value: unknown) => value is T, endpoint: string): T {
  if (!guard(body)) throw new ContractViolationError(endpoint);
  return body;
}

export const NOTIFICATION_PREFERENCES_PATH = '/api/v1/me/notification-preferences';

/** Notificações da organização ativa e preferência da conta (spec 008; ADR 0012). */
@Injectable({ providedIn: 'root' })
export class NotificationApi {
  private readonly http = inject(HttpClient);

  async page(organizationId: string, cursor: string | null): Promise<NotificationPage> {
    const url = tenantUrl(organizationId, '/notifications');
    const params = cursor ? new HttpParams().set('cursor', cursor) : new HttpParams();
    return checked(
      await firstValueFrom(this.http.get<unknown>(url, { params })),
      isNotificationPage,
      url,
    );
  }

  async unreadCount(organizationId: string): Promise<UnreadCount> {
    const url = tenantUrl(organizationId, '/notifications/unread-count');
    return checked(await firstValueFrom(this.http.get<unknown>(url)), isUnreadCount, url);
  }

  async markRead(organizationId: string, notificationId: string): Promise<void> {
    const url = tenantUrl(organizationId, `/notifications/${notificationId}/read`);
    await firstValueFrom(this.http.post(url, {}));
  }

  /** Até a notificação mais recente exibida (inclusive): o que chegou depois continua não lido. */
  async markAllRead(organizationId: string, upToId: string): Promise<void> {
    const url = tenantUrl(organizationId, '/notifications/read-all');
    await firstValueFrom(this.http.post(url, { upToId }));
  }

  async preference(): Promise<NotificationPreference> {
    return checked(
      await firstValueFrom(this.http.get<unknown>(NOTIFICATION_PREFERENCES_PATH)),
      isNotificationPreference,
      NOTIFICATION_PREFERENCES_PATH,
    );
  }

  async updatePreference(emailDigest: boolean): Promise<NotificationPreference> {
    return checked(
      await firstValueFrom(this.http.put<unknown>(NOTIFICATION_PREFERENCES_PATH, { emailDigest })),
      isNotificationPreference,
      NOTIFICATION_PREFERENCES_PATH,
    );
  }
}
