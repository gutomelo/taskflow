import {
  HttpErrorResponse,
  HttpXsrfTokenExtractor,
  type HttpEvent,
  type HttpHandlerFn,
  type HttpInterceptorFn,
  type HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError, type Observable } from 'rxjs';
import { AuthApi } from './auth-api';
import { AuthStore } from './auth.store';
import { safeReturnUrl } from './return-url';
import { SessionRefresher } from './session-refresher';

const API_PREFIX = '/api/v1/';
export const CSRF_HEADER = 'X-CSRF-Token';

/** Endpoints em que 401 não significa "access token vencido" (ou que são o próprio refresh). */
const NO_REFRESH_PATHS = new Set([
  '/api/v1/auth/csrf',
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
  '/api/v1/auth/password/forgot',
  '/api/v1/auth/password/reset',
]);

/**
 * Para chamadas a `/api/v1/*`:
 * - **CSRF dessincronizado** (403 `CSRF_VALIDATION_FAILED` numa mutação): pede um novo token e
 *   repete uma vez (ex.: cookie apagado por `Clear-Site-Data` em outra aba).
 * - **401 em rota autenticada**: renova a sessão (voo único, coordenado entre abas) e repete a
 *   requisição original **uma** vez. Sessão recusada ⇒ estado anônimo e, se havia usuário,
 *   `/login?returnUrl=…`.
 *
 * O interceptor de XSRF do Angular roda **antes** deste: as repetições releem o token do cookie,
 * que o servidor pode ter reemitido no refresh (T29/B1).
 */
export const sessionRefreshInterceptor: HttpInterceptorFn = (request, next) => {
  const path = request.url.split(/[?#]/)[0] ?? request.url;
  if (!path.startsWith(API_PREFIX)) return next(request);

  const xsrf = inject(HttpXsrfTokenExtractor);
  const api = inject(AuthApi);
  const withFreshCsrf = (original: HttpRequest<unknown>) => {
    const token = xsrf.getToken();
    return original.headers.has(CSRF_HEADER) && token
      ? original.clone({ setHeaders: { [CSRF_HEADER]: token } })
      : original;
  };
  const send = (outgoing: HttpRequest<unknown>) =>
    sendWithCsrfRecovery(outgoing, next, api, withFreshCsrf);

  if (NO_REFRESH_PATHS.has(path)) return send(request);

  const refresher = inject(SessionRefresher);
  const store = inject(AuthStore);
  const router = inject(Router);

  return send(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      return from(refresher.refresh()).pipe(
        switchMap((outcome) => {
          if (outcome === 'refreshed') return next(withFreshCsrf(request));
          if (outcome === 'session_ended' && store.endSession()) {
            void router.navigate(['/login'], {
              queryParams: { returnUrl: safeReturnUrl(router.url) },
            });
          }
          return throwError(() => error);
        }),
      );
    }),
  );
};

function sendWithCsrfRecovery(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
  api: AuthApi,
  withFreshCsrf: (request: HttpRequest<unknown>) => HttpRequest<unknown>,
): Observable<HttpEvent<unknown>> {
  return next(request).pipe(
    catchError((error: unknown) => {
      if (!isCsrfFailure(error) || !request.headers.has(CSRF_HEADER)) {
        return throwError(() => error);
      }
      return from(api.issueCsrfToken()).pipe(switchMap(() => next(withFreshCsrf(request))));
    }),
  );
}

function isCsrfFailure(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse) || error.status !== 403) return false;
  const body: unknown = error.error;
  return (
    typeof body === 'object' &&
    body !== null &&
    'code' in body &&
    body.code === 'CSRF_VALIDATION_FAILED'
  );
}
