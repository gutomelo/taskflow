import { computed, inject, Injectable, signal } from '@angular/core';
import type { CurrentUser } from '@taskflow/contracts';
import { AuthApi } from './auth-api';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

type AuthState = Readonly<{ status: AuthStatus; user: CurrentUser | null }>;

/**
 * Estado da sessão no navegador (ADR 0009: Signals, sem NgRx). Nenhum token passa por aqui:
 * a sessão vive em cookies HttpOnly; o store só conhece o usuário devolvido por `/me`.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly api = inject(AuthApi);
  private readonly state = signal<AuthState>({ status: 'unknown', user: null });

  readonly status = computed(() => this.state().status);
  readonly user = computed(() => this.state().user);
  readonly isAuthenticated = computed(() => this.state().status === 'authenticated');

  /**
   * Executado antes da primeira navegação (`provideAppInitializer`): guards já encontram o
   * estado resolvido. Nunca rejeita — com a API fora, a aplicação abre como anônima.
   */
  async bootstrap(): Promise<void> {
    // Sem o cookie CSRF as mutações falham com 403, mas leitura e páginas públicas seguem
    // funcionando; o próximo bootstrap (ou login) emite outro.
    await this.api.issueCsrfToken().catch(() => undefined);
    try {
      this.signIn(await this.api.currentUser());
    } catch {
      // 401 (sem sessão, mesmo após o refresh do interceptor) ou API indisponível.
      this.state.set({ status: 'anonymous', user: null });
    }
  }

  signIn(user: CurrentUser): void {
    this.state.set({ status: 'authenticated', user });
  }

  /** E-mail confirmado (CA-03): reflete no usuário sem nova chamada ao `/me`. */
  markEmailVerified(): void {
    const user = this.user();
    if (user) this.state.set({ status: 'authenticated', user: { ...user, emailVerified: true } });
  }

  /** Sessão encerrada no servidor. Devolve se havia usuário autenticado (para redirecionar). */
  endSession(): boolean {
    const wasAuthenticated = this.isAuthenticated();
    this.state.set({ status: 'anonymous', user: null });
    return wasAuthenticated;
  }
}
