import type { Route } from '@angular/router';
import { accountRoutes } from './features/account/account.routes';
import { authRoutes } from './features/auth/auth.routes';
import { organizationsRoutes } from './features/organizations/organizations.routes';

export const appRoutes: Route[] = [
  ...authRoutes,
  ...accountRoutes,
  ...organizationsRoutes,
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
