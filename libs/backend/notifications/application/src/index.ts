export type { DigestEmail, DigestMailer } from './lib/ports/digest-mailer';
export type {
  DigestAddress,
  NotificationPeople,
  OrganizationMembership,
} from './lib/ports/notification-people';
export {
  activeMentionKey,
  type MentionReference,
  type NotificationTargets,
  type Viewer,
  type VisibleTask,
} from './lib/ports/notification-targets';
export type {
  DigestDependencies,
  NotificationsDependencies,
} from './lib/shared/notifications-dependencies';
export { InvalidCursorError } from './lib/shared/notifications-errors';
export {
  NOTIFICATIONS_COUNT_POLICY,
  NOTIFICATIONS_LIST_POLICY,
  NOTIFICATIONS_WRITE_POLICY,
} from './lib/shared/notifications-limits';
export {
  PlanDigestsUseCase,
  PurgeOldNotificationsUseCase,
  SendDigestUseCase,
  type DigestOutcome,
} from './lib/use-cases/digest.use-cases';
export {
  CountUnreadUseCase,
  GetNotificationPreferenceUseCase,
  ListNotificationsUseCase,
  MarkAllReadUseCase,
  MarkReadUseCase,
  UpdateNotificationPreferenceUseCase,
  type NotificationView,
} from './lib/use-cases/notification-queries.use-cases';
export {
  RecordNotificationsUseCase,
  type RecordOutcome,
} from './lib/use-cases/record-notifications.use-case';
