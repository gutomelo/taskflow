import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';

/** Mesmos limites do contrato (`tokenField`): 16–256 caracteres base64url. */
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * Lê o token de um link de e-mail (`…#token=…`) e **remove o fragmento da URL** sem recarregar:
 * o token não fica no histórico, não é enviado a nenhum servidor e não vaza via `Referer`.
 * Token com formato inválido é descartado como se não existisse.
 */
@Injectable({ providedIn: 'root' })
export class LinkToken {
  private readonly document = inject(DOCUMENT);

  takeFromFragment(): string | null {
    const view = this.document.defaultView;
    if (!view) return null;
    const { location, history } = view;
    if (!location.hash) return null;

    const token = new URLSearchParams(location.hash.slice(1)).get('token');
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    return token !== null && TOKEN_FORMAT.test(token) ? token : null;
  }
}

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
