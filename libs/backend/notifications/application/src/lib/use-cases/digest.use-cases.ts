import {
  NOTIFICATION_LIMITS,
  type NotificationRecord,
} from '@taskflow/backend/notifications/domain';
import type { DigestEmail } from '../ports/digest-mailer';
import type {
  DigestDependencies,
  NotificationsDependencies,
} from '../shared/notifications-dependencies';
import { PURGE_BATCH } from '../shared/notifications-limits';
import { visibleOnly, type VisibleNotification } from '../shared/visibility';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const windowStart = (now: Date) =>
  new Date(now.getTime() - NOTIFICATION_LIMITS.digestWindowHours * HOUR_MS);

/**
 * BR-034 (worker, de hora em hora): quem tem notificações candidatas ao resumo — não lidas, não
 * enviadas, das últimas 24 h (decisão 10) — e a preferência ligada. Só o fan-out: o envio é um
 * job por pessoa e hora (D5).
 */
export class PlanDigestsUseCase {
  constructor(private readonly deps: Pick<NotificationsDependencies, 'notifications'>) {}

  execute(now: Date): Promise<ReadonlyArray<string>> {
    return this.deps.notifications.digestRecipients(windowStart(now));
  }
}

export type DigestOutcome = 'sent' | 'empty' | 'disabled' | 'no-address' | 'nothing-visible';

/** Chave e link de uma tarefa (chave `PROJ-N`; o slug e a chave são codificados na URL). */
function taskUrl(appUrl: string, organizationSlug: string, key: string): string {
  const dash = key.lastIndexOf('-');
  const projectKey = key.slice(0, dash);
  const number = key.slice(dash + 1);
  return `${appUrl}/o/${encodeURIComponent(organizationSlug)}/projects/${encodeURIComponent(projectKey)}/tasks/${encodeURIComponent(number)}`;
}

/**
 * BR-034 (um job por pessoa e hora): sem lock (M2 da segurança, B1 da arquitetura). Lê até 50
 * candidatas, filtra a visibilidade por organização com o papel atual, envia se sobrar algo e só
 * depois marca **todas** as candidatas lidas como enviadas (as invisíveis não voltam). Queda entre
 * envio e marcação reenvia ("pelo menos uma vez").
 */
export class SendDigestUseCase {
  constructor(
    private readonly deps: Pick<
      NotificationsDependencies,
      'notifications' | 'preferences' | 'targets' | 'people' | 'clock'
    > &
      DigestDependencies,
  ) {}

  async execute(userId: string, now: Date): Promise<DigestOutcome> {
    const candidates = await this.deps.notifications.digestCandidates(
      userId,
      windowStart(now),
      NOTIFICATION_LIMITS.digestMaxItems,
    );
    if (candidates.length === 0) return 'empty';
    // A preferência pode ter mudado depois do fan-out: desligada, nada é enviado nem marcado.
    if (!(await this.deps.preferences.emailDigest(userId))) return 'disabled';
    const address = await this.deps.people.digestAddress(userId);
    const ids = candidates.map((candidate) => candidate.id);
    if (!address) {
      await this.deps.notifications.markEmailed(userId, ids, now);
      return 'no-address';
    }
    const digest = await this.compose(userId, candidates);
    if (digest.groups.length === 0) {
      await this.deps.notifications.markEmailed(userId, ids, now);
      return 'nothing-visible';
    }
    await this.deps.mailer.send(address, digest);
    await this.deps.notifications.markEmailed(userId, ids, this.deps.clock.now());
    return 'sent';
  }

  private async compose(
    userId: string,
    candidates: ReadonlyArray<NotificationRecord>,
  ): Promise<DigestEmail> {
    const byOrganization = new Map<string, NotificationRecord[]>();
    for (const candidate of candidates) {
      byOrganization.set(candidate.organizationId, [
        ...(byOrganization.get(candidate.organizationId) ?? []),
        candidate,
      ]);
    }
    const memberships = await this.deps.people.memberships(userId, [...byOrganization.keys()]);
    const groups: DigestEmail['groups'][number][] = [];
    for (const [organizationId, rows] of byOrganization) {
      const membership = memberships.get(organizationId);
      if (!membership) continue;
      const visible: VisibleNotification[] = await visibleOnly(
        this.deps,
        organizationId,
        {
          userId,
          organizationRole: membership.role,
        },
        rows,
      );
      if (visible.length === 0) continue;
      const keys = [...new Set(visible.map(({ task }) => task.key))];
      groups.push({
        organizationSlug: membership.slug,
        mentions: visible.filter(({ notification }) => notification.kind === 'mention').length,
        assignments: visible.filter(({ notification }) => notification.kind === 'assignment')
          .length,
        tasks: keys.map((key) => ({ key, url: taskUrl(this.deps.appUrl, membership.slug, key) })),
      });
    }
    return {
      groups: groups.sort((a, b) => a.organizationSlug.localeCompare(b.organizationSlug)),
      preferencesUrl: `${this.deps.appUrl}/account/notifications`,
    };
  }
}

/** Retenção (decisão 5): apaga, em lotes, notificações com mais de 90 dias. */
export class PurgeOldNotificationsUseCase {
  constructor(private readonly deps: Pick<NotificationsDependencies, 'notifications'>) {}

  async execute(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_LIMITS.retentionDays * DAY_MS);
    let total = 0;
    for (;;) {
      const removed = await this.deps.notifications.purgeBefore(cutoff, PURGE_BATCH);
      total += removed;
      if (removed < PURGE_BATCH) return total;
    }
  }
}
