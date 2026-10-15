import { inject } from '@angular/core';
import { RedirectCommand, Router, type CanActivateFn, type ResolveFn } from '@angular/router';
import type { MyOrganization } from '@taskflow/contracts';
import { AuthStore } from '../auth';
import { LastOrganizationStorage } from './last-organization';
import { MyOrganizationsStore } from './my-organizations.store';

/** Estado de navegação lido por `/organizations` para avisar "organização não encontrada". */
export const ORGANIZATION_NOT_FOUND_STATE = { organizationNotFound: true } as const;

/**
 * `/o/:slug` (RF-04): resolve o slug pelas memberships do usuário. Inexistente ou sem membership
 * ⇒ `/organizations` com aviso — a mesma experiência para os dois casos (sem oráculo).
 */
export const organizationResolver: ResolveFn<MyOrganization> = async (route) => {
  // Tudo injetado antes do primeiro `await`: depois dele não há mais contexto de injeção.
  const router = inject(Router);
  const store = inject(MyOrganizationsStore);
  const auth = inject(AuthStore);
  const lastOrganization = inject(LastOrganizationStorage);
  const slug = route.paramMap.get('slug') ?? '';
  const organization = await store.resolve(slug).catch(() => null);
  if (!organization) {
    return new RedirectCommand(router.parseUrl('/organizations'), {
      state: ORGANIZATION_NOT_FOUND_STATE,
    });
  }
  const userId = auth.user()?.id;
  if (userId) lastOrganization.write(userId, organization.slug);
  return organization;
};

/**
 * `/` (CA-10): última organização aberta, senão a primeira; sem organização, o onboarding.
 * Falha ao carregar ⇒ `/organizations`, que mostra o erro com nova tentativa.
 */
export const homeRedirectGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const store = inject(MyOrganizationsStore);
  const userId = inject(AuthStore).user()?.id ?? '';
  const last = inject(LastOrganizationStorage).read(userId);
  try {
    await store.ensureLoaded();
  } catch {
    return router.parseUrl('/organizations');
  }
  const items = store.items();
  const target = items.find((item) => item.slug === last) ?? items[0];
  return router.parseUrl(target ? `/o/${encodeURIComponent(target.slug)}` : '/organizations/new');
};
