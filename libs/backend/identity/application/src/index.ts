export type {
  AccessTokenIssuer,
  AccessTokenSubject,
  AccessTokenVerifier,
  AccessTokenVerifyOptions,
  IssuedAccessToken,
} from './lib/ports/access-tokens';
export type { SessionRevocationList } from './lib/ports/session-revocation-list';
export { InvalidCredentialsError } from './lib/shared/identity-errors';
export { toCurrentUserView, type CurrentUserView } from './lib/shared/current-user-view';
export { toSessionClient, type ClientInfo } from './lib/shared/client-info';
export {
  IdentityEventType,
  type PasswordResetRequestedPayload,
  type UserEventPayload,
} from './lib/shared/identity-events';
export { EMAIL_DELIVERY_POLICIES } from './lib/shared/rate-limit-policies';
export { EmailDeliveryThrottle } from './lib/shared/email-delivery-throttle';
export {
  RegisterUserUseCase,
  type RegisterUserCommand,
  type RegisterUserDependencies,
} from './lib/use-cases/register-user.use-case';
export {
  LoginUseCase,
  type LoginCommand,
  type LoginDependencies,
  type LoginResult,
} from './lib/use-cases/login.use-case';
export { GetCurrentUserUseCase } from './lib/use-cases/get-current-user.use-case';
export {
  LogoutUseCase,
  type LogoutCommand,
  type LogoutDependencies,
} from './lib/use-cases/logout.use-case';
export type { SecurityEvent, SecurityEventRecorder } from './lib/ports/security-event-recorder';
export { SessionNotFoundError } from './lib/shared/identity-errors';
export { summarizeUserAgent, type DeviceSummary } from './lib/shared/user-agent';
export {
  RefreshSessionUseCase,
  type RefreshSessionCommand,
  type RefreshSessionDependencies,
  type RefreshSessionResult,
} from './lib/use-cases/refresh-session.use-case';
export { ListSessionsUseCase, type SessionSummary } from './lib/use-cases/list-sessions.use-case';
export {
  RevokeSessionUseCase,
  type RevokeSessionDependencies,
} from './lib/use-cases/revoke-session.use-case';
