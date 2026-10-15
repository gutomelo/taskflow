import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import { AuthApi } from './auth-api';

/** Nome do lock compartilhado por todas as abas da mesma origem. */
export const SESSION_REFRESH_LOCK = 'taskflow:session-refresh';

/** Web Locks API (injetável para testes); `null` em navegadores sem suporte. */
export const WEB_LOCKS = new InjectionToken<LockManager | null>('WEB_LOCKS', {
  providedIn: 'root',
  factory: () => globalThis.navigator?.locks ?? null,
});

/**
 * - `refreshed`: há cookies novos; a requisição original pode ser repetida.
 * - `session_ended`: o servidor recusou a sessão (401); o usuário precisa entrar de novo.
 * - `unavailable`: falha de rede, timeout ou 5xx; a sessão pode continuar válida.
 */
export type RefreshOutcome = 'refreshed' | 'session_ended' | 'unavailable';

/**
 * Renovação de sessão em voo único (BR-012). Dentro da aba, chamadas simultâneas compartilham
 * a mesma promessa; entre abas, o Web Lock serializa as renovações, e cada uma usa o refresh
 * token mais recente do cookie — sem reapresentar um token já rotacionado, o que a API trataria
 * como reutilização e revogaria a sessão.
 */
@Injectable({ providedIn: 'root' })
export class SessionRefresher {
  private readonly api = inject(AuthApi);
  private readonly locks = inject(WEB_LOCKS);
  private inFlight: Promise<RefreshOutcome> | null = null;

  refresh(): Promise<RefreshOutcome> {
    this.inFlight ??= this.withCrossTabLock(() => this.attempt()).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private withCrossTabLock(work: () => Promise<RefreshOutcome>): Promise<RefreshOutcome> {
    return this.locks ? this.locks.request(SESSION_REFRESH_LOCK, work) : work();
  }

  private async attempt(): Promise<RefreshOutcome> {
    try {
      await this.api.refreshSession();
      return 'refreshed';
    } catch (error) {
      if (!(error instanceof HttpErrorResponse)) return 'unavailable';
      // Corrida legítima: outra requisição acabou de rotacionar e os cookies novos já chegaram.
      if (error.status === 409 && problemCode(error) === 'REFRESH_IN_PROGRESS') return 'refreshed';
      return error.status === 401 ? 'session_ended' : 'unavailable';
    }
  }
}

function problemCode(error: HttpErrorResponse): unknown {
  const body: unknown = error.error;
  return typeof body === 'object' && body !== null && 'code' in body ? body.code : undefined;
}
