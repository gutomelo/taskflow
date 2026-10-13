import type { OrganizationPermission } from '@taskflow/contracts';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Routes } from '@angular/router';
import { AuthStore } from '../auth';
import { WEB_LOCKS } from '../auth/session-refresher';
import { organizationNotFoundInterceptor } from './organization-not-found.interceptor';
import { provideOrganizations } from './provide-organizations';

export const MINE = '/api/v1/me/organizations';

export const ana = {
  id: '01a11e1a-99fa-7501-a131-4ad99a122005',
  name: 'Ana Souza',
  email: 'ana@exemplo.com',
  emailVerified: true,
};

const MANAGER_CAPABILITIES: OrganizationPermission[] = [
  'organization:read',
  'organization:update',
  'member:invite',
  'member:change-role',
  'member:remove',
  'project:create',
];
const READ_ONLY_CAPABILITIES: OrganizationPermission[] = ['organization:read'];

export const acme = {
  id: '0192a000-0000-7000-8000-000000000001',
  name: 'Acme',
  slug: 'acme',
  role: 'owner' as const,
  capabilities: MANAGER_CAPABILITIES,
};
export const beta = {
  id: '0192a000-0000-7000-8000-000000000002',
  name: 'Beta',
  slug: 'beta',
  role: 'viewer' as const,
  capabilities: READ_ONLY_CAPABILITIES,
};

/** Providers de produção de organizations + backend simulado. */
export function setupOrganizationsTesting(routes: Routes = []) {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([organizationNotFoundInterceptor])),
      provideHttpClientTesting(),
      provideRouter(routes),
      provideOrganizations(),
      { provide: WEB_LOCKS, useValue: null },
    ],
  });
  return {
    backend: TestBed.inject(HttpTestingController),
    auth: TestBed.inject(AuthStore),
  };
}

export const settle = () => new Promise<void>((resolve) => setTimeout(resolve));

/** Espera a requisição sair (guards e componentes lazy são assíncronos) e a devolve. */
export async function nextRequest(
  backend: HttpTestingController,
  url: string,
): Promise<TestRequest> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [request] = backend.match(url);
    if (request) return request;
    await settle();
  }
  return backend.expectOne(url);
}
