import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ChangePasswordRequest, SessionList } from '@taskflow/contracts';
import { ContractViolationError, isSessionList } from '../../core/http/contract-guards';

export const ACCOUNT_SECURITY_PATHS = {
  sessions: '/api/v1/me/sessions',
  session: (id: string) => `/api/v1/me/sessions/${encodeURIComponent(id)}`,
  password: '/api/v1/me/password',
} as const;

/** Verifica a resposta da listagem (usado também como `parse` do `httpResource`). */
export function parseSessionList(body: unknown): SessionList {
  if (!isSessionList(body)) throw new ContractViolationError(ACCOUNT_SECURITY_PATHS.sessions);
  return body;
}

/** Sessões e troca de senha da conta autenticada (spec 001, CA-07, CA-09). */
@Injectable({ providedIn: 'root' })
export class AccountSecurityApi {
  private readonly http = inject(HttpClient);

  /** 204. Encerrar a sessão atual faz a API limpar os cookies deste navegador. */
  revokeSession(sessionId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(ACCOUNT_SECURITY_PATHS.session(sessionId)));
  }

  /** 204 com novos cookies de sessão e CSRF; as outras sessões são revogadas (CA-09). */
  changePassword(request: ChangePasswordRequest): Promise<void> {
    return firstValueFrom(this.http.post<void>(ACCOUNT_SECURITY_PATHS.password, request));
  }
}
