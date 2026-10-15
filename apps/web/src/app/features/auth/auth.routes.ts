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
  {
    path: 'forgot-password',
    title: 'Esqueci minha senha · TaskFlow',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./forgot-password.page').then((module) => module.ForgotPasswordPage),
  },
  {
    // Sem guard: o link funciona com ou sem sessão; a redefinição encerra todas as sessões.
    path: 'reset-password',
    title: 'Redefinir senha · TaskFlow',
    loadComponent: () => import('./reset-password.page').then((module) => module.ResetPasswordPage),
  },
  {
    // Sem guard: sem sessão a página pede login guardando o token (CA-03, BR-017).
    path: 'verify-email',
    title: 'Confirmar e-mail · TaskFlow',
    loadComponent: () => import('./verify-email.page').then((module) => module.VerifyEmailPage),
  },
];
