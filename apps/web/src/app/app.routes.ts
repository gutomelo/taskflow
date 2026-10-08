import type { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
    title: 'Status do sistema · TaskFlow',
    loadComponent: () =>
      import('./features/system-status/system-status.page').then(
        (module) => module.SystemStatusPage,
      ),
  },
  { path: '**', redirectTo: '' },
];
