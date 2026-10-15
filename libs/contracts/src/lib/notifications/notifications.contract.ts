import { z } from 'zod';

/** Contratos HTTP de notificações (spec 008). Notificações são pessoais (só do próprio usuário). */

export const notificationKindSchema = z.enum(['mention', 'assignment']);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationIdParamSchema = z.object({ notificationId: z.uuid() });

export const notificationListQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  /** Padrão 25, máximo 50. Páginas podem vir curtas (validade filtrada na leitura). */
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const notificationSchema = z.object({
  id: z.uuid(),
  kind: notificationKindSchema,
  /** `name: null` = "Ex-membro". */
  actor: z.object({ userId: z.uuid(), name: z.string().nullable() }),
  task: z.object({ id: z.uuid(), key: z.string(), title: z.string() }),
  commentId: z.uuid().nullable(),
  occurredAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const notificationPageSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationPage = z.infer<typeof notificationPageSchema>;

export const unreadCountSchema = z.object({
  count: z.int().min(0).max(99),
  /** Mais que 99 visíveis: a interface mostra "99+". */
  capped: z.boolean(),
});
export type UnreadCount = z.infer<typeof unreadCountSchema>;

/** Marca as não lidas até a notificação indicada (inclusive); ausente = todas. */
export const markAllReadRequestSchema = z.strictObject({ upToId: z.uuid().optional() });
export type MarkAllReadRequest = z.infer<typeof markAllReadRequestSchema>;

export const notificationPreferenceSchema = z.object({ emailDigest: z.boolean() });
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const updateNotificationPreferenceRequestSchema = z.strictObject({
  emailDigest: z.boolean(),
});
