import {
  effect,
  inject,
  provideEnvironmentInitializer,
  untracked,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { RouteReuseStrategy } from '@angular/router';
import { AuthStore } from '../auth';
import { LastOrganizationStorage } from './last-organization';
import { MyOrganizationsStore } from './my-organizations.store';
import { OrganizationRouteReuseStrategy } from './organization-route-reuse.strategy';

/**
 * Organizações no navegador: estratégia de reuso de `/o/:slug` e limpeza ao trocar de sessão
 * (nada da conta anterior fica em memória nem a última organização no storage).
 */
export function provideOrganizations(): Array<Provider | EnvironmentProviders> {
  return [
    { provide: RouteReuseStrategy, useClass: OrganizationRouteReuseStrategy },
    provideEnvironmentInitializer(() => {
      const auth = inject(AuthStore);
      const organizations = inject(MyOrganizationsStore);
      const lastOrganization = inject(LastOrganizationStorage);
      let previousUserId: string | null = null;
      effect(() => {
        const userId = auth.user()?.id ?? null;
        const status = auth.status();
        untracked(() => {
          organizations.syncUser(userId);
          // Logout (ou sessão encerrada): a conveniência sai junto com a sessão.
          if (status === 'anonymous' && previousUserId !== null) lastOrganization.clear();
          previousUserId = userId;
        });
      });
    }),
  ];
}
