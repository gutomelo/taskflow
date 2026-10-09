import type { Route } from '@angular/router';
import { authGuard } from '../../core/auth';

/** Área autenticada da conta (spec 001). */
export const accountRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Início · TaskFlow',
    canActivate: [authGuard],
    loadComponent: () => import('../home/home.page').then((module) => module.HomePage),
  },
  {
    path: 'account/security',
    title: 'Segurança da conta · TaskFlow',
    canActivate: [authGuard],
    loadComponent: () => import('./security.page').then((module) => module.SecurityPage),
  },
];
