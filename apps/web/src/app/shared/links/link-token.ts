import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

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
