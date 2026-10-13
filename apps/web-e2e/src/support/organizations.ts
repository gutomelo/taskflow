import type { Page } from '@playwright/test';

/** Capacidades que a API devolveria por papel (spec 006); o E2E só simula a resposta. */
const CAPABILITIES: Record<string, string[]> = {
  owner: [
    'organization:read',
    'organization:update',
    'member:invite',
    'member:change-role',
    'member:remove',
    'project:create',
  ],
  admin: [
    'organization:read',
    'organization:update',
    'member:invite',
    'member:change-role',
    'member:remove',
    'project:create',
  ],
  member: ['organization:read', 'project:create'],
  viewer: ['organization:read'],
};

/**
 * Sessões simuladas (login respondido pelo `page.route`) não existem na API real: o seletor de
 * organização do cabeçalho (spec 002) receberia 401 e encerraria a sessão. Responde "minhas
 * organizações" junto com o login simulado, com as capacidades de cada papel.
 */
export async function mockMyOrganizations(
  page: Page,
  items: ReadonlyArray<{ id: string; name: string; slug: string; role: string }> = [],
): Promise<void> {
  const body = {
    items: items.map((item) => ({ ...item, capabilities: CAPABILITIES[item.role] ?? [] })),
  };
  await page.route('**/api/v1/me/organizations', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}
