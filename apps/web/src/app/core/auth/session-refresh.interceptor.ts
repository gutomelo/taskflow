import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthStore } from './auth.store';
import { safeReturnUrl } from './return-url';
import { SessionRefresher } from './session-refresher';

const API_PREFIX = '/api/v1/';

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
 * 401 numa chamada autenticada ⇒ renova a sessão (voo único, coordenado entre abas) e repete
 * a requisição original **uma** vez — a repetição não passa de novo por este interceptor.
 * Sessão recusada ⇒ estado anônimo e, se havia usuário, `/login?returnUrl=…`.
 */
export const sessionRefreshInterceptor: HttpInterceptorFn = (request, next) => {
  const path = request.url.split(/[?#]/)[0] ?? request.url;
  if (!path.startsWith(API_PREFIX) || NO_REFRESH_PATHS.has(path)) return next(request);

  const refresher = inject(SessionRefresher);
  const store = inject(AuthStore);
  const router = inject(Router);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }
      return from(refresher.refresh()).pipe(
        switchMap((outcome) => {
          if (outcome === 'refreshed') return next(request);
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
