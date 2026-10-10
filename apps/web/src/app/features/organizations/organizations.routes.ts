import type { Route } from '@angular/router';
import { authGuard } from '../../core/auth';
import {
  homeRedirectGuard,
  organizationResolver,
  RECREATE_ON_PARAM_CHANGE,
} from '../../core/organizations';

/** Organizações (spec 002): início, onboarding, lista e a área `/o/:slug`. */
export const organizationsRoutes: Route[] = [
  {
    // CA-10: `/` leva à última organização, à primeira ou ao onboarding.
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard, homeRedirectGuard],
    children: [],
  },
  {
    path: 'organizations',
    pathMatch: 'full',
    title: 'Organizações · TaskFlow',
    canActivate: [authGuard],
    loadComponent: () => import('./organizations.page').then((module) => module.OrganizationsPage),
  },
  {
    path: 'organizations/new',
    title: 'Criar organização · TaskFlow',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./create-organization.page').then((module) => module.CreateOrganizationPage),
  },
  {
    // Sem guard: sem sessão a página pede login guardando o token em memória (RF-08).
    path: 'invitations/accept',
    title: 'Convite · TaskFlow',
    loadComponent: () =>
      import('./accept-invitation.page').then((module) => module.AcceptInvitationPage),
  },
  {
    path: 'o/:slug',
    canActivate: [authGuard],
    resolve: { organization: organizationResolver },
    data: { [RECREATE_ON_PARAM_CHANGE]: true },
    loadComponent: () =>
      import('./organization-layout').then((module) => module.OrganizationLayout),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Início · TaskFlow',
        loadComponent: () =>
          import('./organization-home.page').then((module) => module.OrganizationHomePage),
      },
      {
        path: 'members',
        title: 'Membros · TaskFlow',
        loadComponent: () => import('./members.page').then((module) => module.MembersPage),
      },
      {
        path: 'settings',
        title: 'Configurações · TaskFlow',
        loadComponent: () => import('./settings.page').then((module) => module.SettingsPage),
      },
    ],
  },
];
