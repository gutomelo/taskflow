import type { Route } from '@angular/router';
import { accountRoutes } from './features/account/account.routes';
import { authRoutes } from './features/auth/auth.routes';

export const appRoutes: Route[] = [
  ...authRoutes,
  ...accountRoutes,
  {
    path: 'status',
    title: 'Status do sistema · TaskFlow',
    loadComponent: () =>
      import('./features/system-status/system-status.page').then(
        (module) => module.SystemStatusPage,
      ),
  },
  // Rota desconhecida: início (que leva ao login quem não está autenticado).
  { path: '**', redirectTo: '' },
];
