export type { Actor, RequestContext } from './lib/context/request-context';
export type { TransactionRunner } from './lib/persistence/transaction-runner';
export {
  createIntegrationEvent,
  type IntegrationEvent,
  type IntegrationEventFactoryDependencies,
  type JsonValue,
} from './lib/events/integration-event';
export type { OutboxWriter } from './lib/events/outbox-writer';
export type { EmailMessage, EmailSender } from './lib/email/email-sender';
export type {
  RateLimitDecision,
  RateLimitPolicy,
  RateLimiter,
} from './lib/rate-limiting/rate-limiter';
export { ServiceBusyError } from './lib/errors/service-busy-error';
export type { Pseudonymizer } from './lib/privacy/pseudonymizer';
export { RateLimitedError } from './lib/errors/rate-limited-error';
// Papéis vivem no kernel (o domínio de organizations precisa deles); reexportados aqui.
export {
  isOrganizationRole,
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from '@taskflow/backend/shared/kernel';
export type { Tenant, TenantRequestContext } from './lib/context/tenant-request-context';
export type {
  SecurityEventBase,
  SecurityEventRecorder,
} from './lib/observability/security-event-recorder';
export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  toPageRequest,
  type PageQuery,
} from './lib/pagination/pagination';
