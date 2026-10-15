import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { AuthStore } from './auth.store';
import { safeReturnUrl } from './return-url';

/**
 * Rotas autenticadas. Guards melhoram a experiência; o controle de acesso é sempre da API.
 * O estado já está resolvido: o bootstrap roda antes da primeira navegação.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  if (inject(AuthStore).isAuthenticated()) return true;
  return inject(Router).createUrlTree(['/login'], {
    queryParams: { returnUrl: safeReturnUrl(state.url) },
  });
};

/** Páginas de visitante (login, cadastro…): quem já entrou segue para o destino pedido. */
export const guestGuard: CanActivateFn = (route) => {
  if (!inject(AuthStore).isAuthenticated()) return true;
  return inject(Router).parseUrl(safeReturnUrl(route.queryParamMap.get('returnUrl')));
};
