import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { isProblemDetails } from '../http/contract-guards';
import { MyOrganizationsStore } from './my-organizations.store';
import { ORGANIZATION_NOT_FOUND_STATE } from './organization.routing';

const TENANT_URL = /\/api\/v1\/organizations\/[^/?#]+/;

/**
 * Qualquer 404 `ORGANIZATION_NOT_FOUND` de uma rota tenant-scoped (membro removido, CA-09):
 * invalida "minhas organizações" e leva a `/organizations`. Não altera nenhuma requisição —
 * o tenant nunca é injetado por interceptor (ADR 0012).
 */
export const organizationNotFoundInterceptor: HttpInterceptorFn = (request, next) => {
  const store = inject(MyOrganizationsStore);
  const router = inject(Router);
  return next(request).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 404 &&
        TENANT_URL.test(request.url) &&
        isProblemDetails(error.error) &&
        error.error.code === 'ORGANIZATION_NOT_FOUND'
      ) {
        store.invalidate();
        void router.navigateByUrl('/organizations', { state: ORGANIZATION_NOT_FOUND_STATE });
      }
      return throwError(() => error);
    }),
  );
};
