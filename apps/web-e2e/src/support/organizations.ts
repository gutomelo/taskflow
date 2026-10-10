import type { Page } from '@playwright/test';

/**
 * Sessões simuladas (login respondido pelo `page.route`) não existem na API real: o seletor de
 * organização do cabeçalho (spec 002) receberia 401 e encerraria a sessão. Responde "minhas
 * organizações" junto com o login simulado.
 */
export async function mockMyOrganizations(
  page: Page,
  items: ReadonlyArray<{ id: string; name: string; slug: string; role: string }> = [],
): Promise<void> {
  await page.route('**/api/v1/me/organizations', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items }),
    }),
  );
}
