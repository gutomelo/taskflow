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
  LOGIN_ATTEMPT_LEASE_MS,
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
export { TokenBelongsToAnotherAccountError } from './lib/shared/identity-errors';
export {
  ResendEmailVerificationUseCase,
  type ResendEmailVerificationDependencies,
} from './lib/use-cases/resend-email-verification.use-case';
export {
  ConfirmEmailVerificationUseCase,
  type ConfirmEmailVerificationCommand,
  type ConfirmEmailVerificationDependencies,
} from './lib/use-cases/confirm-email-verification.use-case';
export { GetUserVerificationStatusUseCase } from './lib/use-cases/get-user-verification-status.use-case';
export {
  FindUserIdByEmailUseCase,
  GetUserAccountsUseCase,
  MAX_ACCOUNTS_PER_QUERY,
  MAX_SEARCH_IDS,
  SearchUsersAmongUseCase,
  type UserAccountView,
} from './lib/use-cases/user-directory.use-cases';
export { CurrentPasswordIncorrectError } from './lib/shared/identity-errors';
export {
  ChangePasswordUseCase,
  type ChangePasswordCommand,
  type ChangePasswordDependencies,
  type ChangePasswordResult,
} from './lib/use-cases/change-password.use-case';
export {
  RequestPasswordResetUseCase,
  type RequestPasswordResetCommand,
  type RequestPasswordResetDependencies,
} from './lib/use-cases/request-password-reset.use-case';
export {
  ResetPasswordUseCase,
  type ResetPasswordCommand,
  type ResetPasswordDependencies,
} from './lib/use-cases/reset-password.use-case';
export type {
  LoginAttemptLease,
  LoginAttemptTracker,
  LoginFailureState,
} from './lib/ports/login-attempt-tracker';
export {
  FREE_LOGIN_FAILURES,
  MAX_LOGIN_DELAY_SECONDS,
  remainingLoginDelaySeconds,
  requiredLoginDelaySeconds,
} from './lib/shared/progressive-login-delay';
export type {
  IdentityEmailRecipient,
  IdentityEmailTemplates,
} from './lib/ports/identity-email-templates';
export type { EmailDeliveryOutcome } from './lib/shared/identity-email-links';
export {
  SendEmailVerificationUseCase,
  type SendEmailVerificationCommand,
  type SendEmailVerificationDependencies,
} from './lib/use-cases/send-email-verification.use-case';
export {
  SendPasswordResetUseCase,
  type SendPasswordResetCommand,
  type SendPasswordResetDependencies,
} from './lib/use-cases/send-password-reset.use-case';
export {
  SendAccountNoticeUseCase,
  type AccountNotice,
  type SendAccountNoticeCommand,
  type SendAccountNoticeDependencies,
} from './lib/use-cases/send-account-notice.use-case';
export type { IdentityDataRetention } from './lib/ports/identity-data-retention';
export {
  IDENTITY_RETENTION_DAYS,
  PurgeExpiredIdentityDataUseCase,
  type IdentityPurgeReport,
} from './lib/use-cases/purge-expired-identity-data.use-case';
