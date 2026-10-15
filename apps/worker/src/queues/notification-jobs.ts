import { UnrecoverableError, type Job } from 'bullmq';
import type { Logger } from 'pino';
import { z } from 'zod';
import {
  CollaborationIntegrationEventType,
  type MentionsAddedPayload,
} from '@taskflow/backend/collaboration/application';
import { MAX_MENTIONS_PER_COMMENT } from '@taskflow/backend/collaboration/domain';
import type {
  RecordNotificationsUseCase,
  RecordOutcome,
} from '@taskflow/backend/notifications/application';
import type { NotificationFact } from '@taskflow/backend/notifications/domain';
import type { OutboxJobData } from '@taskflow/backend/shared/infrastructure';
import {
  TasksIntegrationEventType,
  type AssigneeChangedPayload,
} from '@taskflow/backend/tasks/application';

/** Fila dos eventos de integração que viram notificações (ADR 0017). */
export const NOTIFICATIONS_QUEUE_NAME = 'notifications';

/** Tipos listados um a um: um evento novo de `tasks` não cai aqui sem schema. */
export const NOTIFICATION_EVENT_TYPES: ReadonlyArray<string> = [
  TasksIntegrationEventType.assigneeChanged,
  CollaborationIntegrationEventType.mentionsAdded,
];

// `satisfies`: se o produtor mudar o payload, o worker deixa de compilar (I2 da arquitetura).
const assigneeChangedPayload = z.strictObject({
  organizationId: z.uuid(),
  projectId: z.uuid(),
  taskId: z.uuid(),
  actorUserId: z.uuid(),
  assigneeUserId: z.uuid(),
}) satisfies z.ZodType<AssigneeChangedPayload>;

const mentionsAddedPayload = z.strictObject({
  organizationId: z.uuid(),
  projectId: z.uuid(),
  taskId: z.uuid(),
  commentId: z.uuid(),
  actorUserId: z.uuid(),
  userIds: z
    .array(z.uuid())
    .min(1)
    .max(MAX_MENTIONS_PER_COMMENT)
    .refine((userIds) => new Set(userIds).size === userIds.length, 'Repeated user'),
}) satisfies z.ZodType<MentionsAddedPayload>;

// Fronteira: o job vem do Redis; nada é usado sem validar o envelope e o payload do tipo.
const notificationJobSchema = z.discriminatedUnion('type', [
  z.strictObject({
    eventId: z.uuid(),
    type: z.literal(TasksIntegrationEventType.assigneeChanged),
    occurredAt: z.iso.datetime(),
    payload: assigneeChangedPayload,
  }),
  z.strictObject({
    eventId: z.uuid(),
    type: z.literal(CollaborationIntegrationEventType.mentionsAdded),
    occurredAt: z.iso.datetime(),
    payload: mentionsAddedPayload,
  }),
]);

type NotificationJob = z.infer<typeof notificationJobSchema>;

/**
 * Camada anticorrupção (design, passo 3): o vocabulário dos produtores vira o fato de
 * `notifications`, que nunca importa tipos de `tasks` nem de `collaboration`.
 */
export function toNotificationFact(job: NotificationJob): NotificationFact {
  const common = {
    organizationId: job.payload.organizationId,
    projectId: job.payload.projectId,
    taskId: job.payload.taskId,
    actorUserId: job.payload.actorUserId,
    sourceEventId: job.eventId,
    occurredAt: new Date(job.occurredAt),
  };
  switch (job.type) {
    case TasksIntegrationEventType.assigneeChanged:
      return {
        ...common,
        kind: 'assignment',
        commentId: null,
        recipientUserIds: [job.payload.assigneeUserId],
      };
    case CollaborationIntegrationEventType.mentionsAdded:
      return {
        ...common,
        kind: 'mention',
        commentId: job.payload.commentId,
        recipientUserIds: job.payload.userIds,
      };
  }
}

/**
 * Processa um job da fila `notifications`: valida, traduz e grava (BR-033). Job inválido não tem
 * retry (`UnrecoverableError`); falha de banco propaga para o retry com backoff. Logs só com ids,
 * tipo e contagens.
 */
export function createNotificationJobProcessor(
  record: Pick<RecordNotificationsUseCase, 'execute'>,
  logger: Logger,
) {
  return async (job: Job<OutboxJobData>): Promise<RecordOutcome> => {
    const parsed = notificationJobSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new UnrecoverableError(
        `Invalid notification job: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
      );
    }
    const outcome = await record.execute(toNotificationFact(parsed.data));
    logger.info(
      {
        eventId: parsed.data.eventId,
        type: parsed.data.type,
        attempt: job.attemptsMade + 1,
        outcome,
      },
      'Notification job processed',
    );
    return outcome;
  };
}
