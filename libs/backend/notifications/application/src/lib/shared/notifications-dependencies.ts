import type { RateLimiter } from '@taskflow/backend/shared/application';
import type {
  NotificationPreferenceRepository,
  NotificationRepository,
} from '@taskflow/backend/notifications/domain';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import type { DigestMailer } from '../ports/digest-mailer';
import type { NotificationPeople } from '../ports/notification-people';
import type { NotificationTargets } from '../ports/notification-targets';

/** Dependências dos casos de uso de `notifications` (API e worker montam as suas). */
export interface NotificationsDependencies {
  readonly notifications: NotificationRepository;
  readonly preferences: NotificationPreferenceRepository;
  readonly targets: NotificationTargets;
  readonly people: NotificationPeople;
  readonly rateLimiter: RateLimiter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** O que só o resumo precisa (worker). */
export interface DigestDependencies {
  readonly mailer: DigestMailer;
  /** URL pública do app (configuração; nunca do `Host`). */
  readonly appUrl: string;
}
