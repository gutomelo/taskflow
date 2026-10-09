// Extensões de tipo do pino-http em `express.Request` (`id`, `log`), registradas pelo
// middleware montado no composition root. Referenciadas aqui para chegar a todo consumidor.
/// <reference types="pino-http" />
export { HttpError, type HttpErrorOptions } from './lib/errors/http-error';
export {
  createErrorHandler,
  notFoundHandler,
  sendProblem,
  type DomainErrorMapping,
  type ErrorHandlerOptions,
} from './lib/errors/problem-details';
export { parseBody } from './lib/validation/parse-body';
export { readCookie } from './lib/cookies/cookies';
export {
  createAuthenticate,
  requestContextFrom,
  type AuthenticateOptions,
} from './lib/auth/authenticate';
export {
  createCsrfProtection,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  type CsrfProtection,
  type CsrfProtectionOptions,
} from './lib/csrf/csrf';
export {
  clientIpKey,
  createRateLimit,
  type RateLimitOptions,
} from './lib/rate-limiting/rate-limit';
export { httpLogSerializers } from './lib/logging/http-log-serializers';
