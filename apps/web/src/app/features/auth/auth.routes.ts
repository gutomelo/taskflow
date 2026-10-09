import type { Route } from '@angular/router';
import { guestGuard } from '../../core/auth';

/** Páginas de visitante (spec 001). Quem já entrou é levado ao destino pedido. */
export const authRoutes: Route[] = [
  {
    path: 'login',
    title: 'Entrar · TaskFlow',
    canActivate: [guestGuard],
    loadComponent: () => import('./login.page').then((module) => module.LoginPage),
  },
  {
    path: 'register',
    title: 'Criar conta · TaskFlow',
    canActivate: [guestGuard],
    loadComponent: () => import('./register.page').then((module) => module.RegisterPage),
  },
];
