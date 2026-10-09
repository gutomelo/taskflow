import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { currentUserSchema, type CurrentUser } from '@taskflow/contracts';

/** Tempo máximo do refresh: uma resposta presa não pode segurar o lock entre abas. */
const REFRESH_TIMEOUT_MS = 10_000;
/** O bootstrap bloqueia a primeira renderização: com a API travada, abre como anônimo. */
export const BOOTSTRAP_TIMEOUT_MS = 5_000;

export const AUTH_API_PATHS = {
  csrf: '/api/v1/auth/csrf',
  refresh: '/api/v1/auth/refresh',
  currentUser: '/api/v1/me',
} as const;

/** Chamadas HTTP da sessão (contratos em `@taskflow/contracts`). */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  /** Emite o cookie CSRF (`__Host-tf_csrf`) que o HttpClient ecoa no header das mutações. */
  issueCsrfToken(): Promise<void> {
    return firstValueFrom(
      this.http.get<void>(AUTH_API_PATHS.csrf).pipe(timeout(BOOTSTRAP_TIMEOUT_MS)),
    );
  }

  async currentUser(): Promise<CurrentUser> {
    const body = await firstValueFrom(
      this.http.get(AUTH_API_PATHS.currentUser).pipe(timeout(BOOTSTRAP_TIMEOUT_MS)),
    );
    return currentUserSchema.parse(body);
  }

  refreshSession(): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(AUTH_API_PATHS.refresh, null).pipe(timeout(REFRESH_TIMEOUT_MS)),
    );
  }
}
