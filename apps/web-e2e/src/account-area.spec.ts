import { expect, test, type Page } from '@playwright/test';

// T27: área autenticada no navegador real. Respostas da API simuladas (sem gravar no banco local).
const ana = {
  id: '01a11e1a-99fa-7501-a131-4ad99a122005',
  name: 'Ana Souza',
  email: 'ana@exemplo.com',
  emailVerified: false,
};
const sessions = {
  items: [
    {
      id: '01a11e1a-0000-7000-8000-000000000001',
      createdAt: '2026-10-01T10:00:00.000Z',
      lastUsedAt: '2026-10-09T10:00:00.000Z',
      device: { browser: 'Chrome', os: 'Linux' },
      isCurrent: true,
    },
    {
      id: '01a11e1a-0000-7000-8000-000000000002',
      createdAt: '2026-09-20T10:00:00.000Z',
      lastUsedAt: '2026-10-08T12:00:00.000Z',
      device: { browser: 'Safari', os: 'iOS' },
      isCurrent: false,
    },
  ],
};

async function signIn(page: Page): Promise<void> {
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ana) }),
  );
  await page.goto('/');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2F$/);
  await page.getByLabel('E-mail').fill(ana.email);
  await page.getByLabel('Senha', { exact: true }).fill('Correct-Horse-9');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Olá, Ana Souza!' })).toBeVisible();
}

test('signed-in journey: home, verification banner, security page and sign out', async ({
  page,
}) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });
  let revoked: string | null = null;
  await page.route('**/api/v1/me/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(sessions) }),
  );
  await page.route('**/api/v1/me/sessions/*', (route) => {
    revoked = route.request().url().split('/').pop() ?? null;
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/v1/me/password', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/v1/auth/logout', (route) => route.fulfill({ status: 204 }));

  await signIn(page);
  await expect(page.getByTestId('verification-banner')).toContainText(ana.email);

  await page.getByRole('button', { name: 'Menu da conta de Ana Souza' }).click();
  await page.getByRole('menuitem', { name: 'Segurança da conta' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Segurança da conta' })).toBeVisible();

  const list = page.getByRole('list', { name: 'Sessões ativas' });
  await expect(list.getByRole('listitem').first()).toContainText('Chrome no Linux');
  await expect(list.getByRole('listitem').first()).toContainText('Esta sessão');
  await list.getByRole('button', { name: /Encerrar sessão Safari no iOS/ }).click();
  await expect.poll(() => revoked).toBe(sessions.items[1]?.id);

  await page.getByLabel('Senha atual').fill('Senha-Antiga-1');
  await page.getByLabel('Nova senha').fill('Senha-Nova-2026');
  await page.getByRole('button', { name: 'Trocar senha' }).click();
  await expect(page.getByTestId('password-changed')).toContainText('Senha alterada');

  await page.getByRole('button', { name: 'Menu da conta de Ana Souza' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: /Menu da conta/ })).toHaveCount(0);
  expect(violations).toEqual([]);
});
