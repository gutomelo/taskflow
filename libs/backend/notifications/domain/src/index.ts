export { NotificationNotFoundError } from './lib/errors';
export {
  dedupeKey,
  dedupeKeyOf,
  NOTIFICATION_KINDS,
  NOTIFICATION_LIMITS,
  recipientsOf,
  requireOwn,
  type NewNotification,
  type NotificationFact,
  type NotificationKind,
  type NotificationPosition,
  type NotificationRecord,
} from './lib/notification';
export type {
  InsertOutcome,
  NotificationPreferenceRepository,
  NotificationRepository,
} from './lib/repositories';
