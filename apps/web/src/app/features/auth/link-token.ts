import { Injectable, signal } from '@angular/core';

// `LinkToken` é compartilhado com o aceite de convites (spec 002).
export { LinkToken } from '../../shared/links/link-token';

/**
 * Token de verificação aguardando o clique "Confirmar e-mail". Fica só em memória (nunca em
 * storage): sobrevive à ida ao login dentro do SPA e some ao fechar ou recarregar a aba.
 */
@Injectable({ providedIn: 'root' })
export class PendingEmailVerification {
  private readonly token = signal<string | null>(null);
  readonly current = this.token.asReadonly();

  remember(token: string): void {
    this.token.set(token);
  }

  clear(): void {
    this.token.set(null);
  }
}
