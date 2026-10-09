import type { Route } from '@angular/router';
import { authRoutes } from './features/auth/auth.routes';

export const appRoutes: Route[] = [
  ...authRoutes,
  {
    path: 'status',
    title: 'Status do sistema · TaskFlow',
    loadComponent: () =>
      import('./features/system-status/system-status.page').then(
        (module) => module.SystemStatusPage,
      ),
  },
  // A home autenticada chega com as telas de autenticação (T25–T27); até lá, a raiz leva ao status.
  { path: '', pathMatch: 'full', redirectTo: 'status' },
  { path: '**', redirectTo: 'status' },
];
