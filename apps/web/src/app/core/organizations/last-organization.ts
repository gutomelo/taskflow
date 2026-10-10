import { Injectable } from '@angular/core';

const KEY = 'tf.lastOrganization';

/**
 * Última organização aberta (design da spec 002): `{ userId, slug }` em `localStorage`, só como
 * conveniência de navegação — nada sensível, nunca token. Ignorada para outro usuário e apagada
 * quando a sessão termina (`Clear-Site-Data: "cookies"` não limpa o storage).
 */
@Injectable({ providedIn: 'root' })
export class LastOrganizationStorage {
  read(userId: string): string | null {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (
        typeof value === 'object' &&
        value !== null &&
        'userId' in value &&
        'slug' in value &&
        value.userId === userId &&
        typeof value.slug === 'string'
      ) {
        return value.slug;
      }
      return null;
    } catch {
      // Storage bloqueado (modo privado) ou valor corrompido: só perde a conveniência.
      return null;
    }
  }

  write(userId: string, slug: string): void {
    try {
      localStorage.setItem(KEY, JSON.stringify({ userId, slug }));
    } catch {
      // Storage indisponível: a navegação segue sem lembrar a organização.
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Storage indisponível: não há o que apagar.
    }
  }
}
