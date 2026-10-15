import type { Route } from '@angular/router';
import { authGuard } from '../../core/auth';

/** Área autenticada da conta (spec 001; notificações, spec 008). */
export const accountRoutes: Route[] = [
  {
    path: 'account/security',
    title: 'Segurança da conta · TaskFlow',
    canActivate: [authGuard],
    loadComponent: () => import('./security.page').then((module) => module.SecurityPage),
  },
  {
    // Link do resumo por e-mail (spec 008, RF-09).
    path: 'account/notifications',
    title: 'Notificações da conta · TaskFlow',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./notification-preferences.page').then(
        (module) => module.NotificationPreferencesPage,
      ),
  },
];
