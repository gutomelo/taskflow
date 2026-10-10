import { Injectable, signal } from '@angular/core';

/**
 * Token do convite aguardando o clique "Aceitar" (design da spec 002, "Aceite"). Só em memória —
 * nunca em Web Storage, query ou `returnUrl`: sobrevive à ida ao login dentro do SPA e some ao
 * recarregar a aba (a página orienta a abrir o link de novo).
 */
@Injectable({ providedIn: 'root' })
export class PendingInvitation {
  private readonly token = signal<string | null>(null);
  readonly current = this.token.asReadonly();

  remember(token: string): void {
    this.token.set(token);
  }

  clear(): void {
    this.token.set(null);
  }
}
