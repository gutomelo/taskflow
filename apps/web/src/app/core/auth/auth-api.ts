import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import type { CurrentUser, LoginRequest, RegisterRequest } from '@taskflow/contracts';
import { ContractViolationError, isCurrentUser } from '../http/contract-guards';

/** Tempo máximo do refresh: uma resposta presa não pode segurar o lock entre abas. */
const REFRESH_TIMEOUT_MS = 10_000;
/** O bootstrap bloqueia a primeira renderização: com a API travada, abre como anônimo. */
export const BOOTSTRAP_TIMEOUT_MS = 5_000;

export const AUTH_API_PATHS = {
  csrf: '/api/v1/auth/csrf',
  refresh: '/api/v1/auth/refresh',
  currentUser: '/api/v1/me',
  login: '/api/v1/auth/login',
  logout: '/api/v1/auth/logout',
  resendVerification: '/api/v1/auth/email-verification/resend',
  register: '/api/v1/auth/register',
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
    const body: unknown = await firstValueFrom(
      this.http.get(AUTH_API_PATHS.currentUser).pipe(timeout(BOOTSTRAP_TIMEOUT_MS)),
    );
    return expectCurrentUser(body, AUTH_API_PATHS.currentUser);
  }

  /** Abre a sessão (cookies HttpOnly) e devolve o usuário; a API reemite o cookie CSRF. */
  async login(request: LoginRequest): Promise<CurrentUser> {
    const body: unknown = await firstValueFrom(this.http.post(AUTH_API_PATHS.login, request));
    return expectCurrentUser(body, AUTH_API_PATHS.login);
  }

  /** Encerra a sessão; a resposta traz `Clear-Site-Data: "cookies"` (inclui o cookie CSRF). */
  logout(): Promise<void> {
    return firstValueFrom(this.http.post<void>(AUTH_API_PATHS.logout, null));
  }

  /** Novo link de verificação; exige sessão. 202 (suprimido em silêncio acima do limite). */
  resendEmailVerification(): Promise<void> {
    return firstValueFrom(this.http.post<void>(AUTH_API_PATHS.resendVerification, null));
  }

  /** 202 sempre que os dados são válidos, exista ou não conta com o e-mail (BR-014). */
  register(request: RegisterRequest): Promise<void> {
    return firstValueFrom(this.http.post<void>(AUTH_API_PATHS.register, request));
  }

  refreshSession(): Promise<void> {
    return firstValueFrom(
      this.http.post<void>(AUTH_API_PATHS.refresh, null).pipe(timeout(REFRESH_TIMEOUT_MS)),
    );
  }
}

function expectCurrentUser(body: unknown, endpoint: string): CurrentUser {
  if (!isCurrentUser(body)) throw new ContractViolationError(endpoint);
  return body;
}
