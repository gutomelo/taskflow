import {
  dedupeKeyOf,
  NOTIFICATION_LIMITS,
  recipientsOf,
  type NotificationFact,
} from '@taskflow/backend/notifications/domain';
import type { NotificationsDependencies } from '../shared/notifications-dependencies';

export type RecordOutcome = Readonly<{
  created: number;
  duplicate: number;
  /** Destinatário que saiu da organização ou tarefa excluída antes do processamento (FK). */
  ineligible: number;
  /** Menções acima do teto por (ator, destinatário)/hora. */
  capped: number;
}>;

const HOUR_MS = 60 * 60 * 1000;

/**
 * BR-033 (worker): grava uma notificação por destinatário — sem o ator, uma vez por chave, com o
 * teto de menções contado por `occurred_at` (I3 da arquitetura). Não confere acesso (D8): a
 * validade é decidida na leitura. Cada destinatário é independente (B3 da arquitetura).
 */
export class RecordNotificationsUseCase {
  constructor(
    private readonly deps: Pick<
      NotificationsDependencies,
      'notifications' | 'idGenerator' | 'clock'
    >,
  ) {}

  async execute(fact: NotificationFact): Promise<RecordOutcome> {
    const outcome = { created: 0, duplicate: 0, ineligible: 0, capped: 0 };
    const key = dedupeKeyOf(fact);
    const since = new Date(fact.occurredAt.getTime() - HOUR_MS);
    for (const recipientUserId of recipientsOf(fact)) {
      if (fact.kind === 'mention') {
        const recent = await this.deps.notifications.countMentionsSince(
          fact.organizationId,
          fact.actorUserId,
          recipientUserId,
          since,
        );
        if (recent >= NOTIFICATION_LIMITS.mentionsPerActorAndRecipientPerHour) {
          outcome.capped += 1;
          continue;
        }
      }
      const result = await this.deps.notifications.insert({
        id: this.deps.idGenerator.generate(),
        organizationId: fact.organizationId,
        recipientUserId,
        kind: fact.kind,
        actorUserId: fact.actorUserId,
        projectId: fact.projectId,
        taskId: fact.taskId,
        commentId: fact.kind === 'mention' ? fact.commentId : null,
        dedupeKey: key,
        sourceEventId: fact.sourceEventId,
        occurredAt: fact.occurredAt,
        createdAt: this.deps.clock.now(),
      });
      outcome[result === 'created' ? 'created' : result] += 1;
    }
    return outcome;
  }
}
