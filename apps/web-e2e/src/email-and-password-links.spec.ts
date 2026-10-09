import { expect, test } from '@playwright/test';

// T26: links de e-mail no navegador real (Router + fragmento). Respostas da API simuladas.
const TOKEN = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF12';
const ana = {
  id: '01a11e1a-99fa-7501-a131-4ad99a122005',
  name: 'Ana',
  email: 'ana@exemplo.com',
  emailVerified: false,
};

test('verification link: sign in first, keep the token out of every URL, confirm only on click (CA-03, CA-16)', async ({
  page,
}) => {
  const confirmBodies: unknown[] = [];
  const visitedUrls: string[] = [];
  page.on('framenavigated', (frame) => visitedUrls.push(frame.url()));
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ana) }),
  );
  await page.route('**/api/v1/auth/email-verification/confirm', (route) => {
    confirmBodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });

  await page.goto(`/verify-email#token=${TOKEN}`);

  await expect(page.getByTestId('verify-email-state')).toHaveAttribute('data-state', 'needs_login');
  expect(new URL(page.url()).hash).toBe('');

  await page.getByRole('button', { name: 'Entrar para confirmar' }).click();
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fverify-email$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar no TaskFlow' })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill('ana@exemplo.com');
  await page.getByLabel('Senha', { exact: true }).fill('Correct-Horse-9');
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(/\/verify-email$/);
  await expect(page.getByTestId('verify-email-state')).toHaveAttribute('data-state', 'ready');
  expect(confirmBodies).toEqual([]);

  await page.getByRole('button', { name: 'Confirmar e-mail' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E-mail confirmado' })).toBeVisible();
  expect(confirmBodies).toEqual([{ token: TOKEN }]);

  // O token nunca aparece em URLs depois da leitura inicial (histórico, Referer, logs).
  // O token só aparece até a página removê-lo (carga do documento e navegação inicial do
  // Router); depois disso nenhuma URL o contém (histórico, Referer, logs).
  const cleanedAt = visitedUrls.findIndex((url) => !url.includes(TOKEN));
  expect(cleanedAt).toBeGreaterThan(0);
  expect(visitedUrls.slice(cleanedAt).filter((url) => url.includes(TOKEN))).toEqual([]);
  expect(page.url()).not.toContain(TOKEN);
});

test('reset link: token removed from the address bar, new password accepted, then back to login', async ({
  page,
}) => {
  const resetBodies: unknown[] = [];
  await page.route('**/api/v1/auth/password/reset', (route) => {
    resetBodies.push(route.request().postDataJSON());
    return route.fulfill({ status: 204 });
  });

  await page.goto(`/reset-password#token=${TOKEN}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Redefinir senha' })).toBeVisible();
  expect(page.url()).not.toContain(TOKEN);

  await page.getByLabel('Nova senha').fill('Nova-Senha-2026');
  await page.getByRole('button', { name: 'Redefinir senha' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Senha redefinida' })).toBeVisible();
  expect(resetBodies).toEqual([{ token: TOKEN, newPassword: 'Nova-Senha-2026' }]);
  await page.getByRole('link', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('forgot password: same confirmation for any address', async ({ page }) => {
  await page.route('**/api/v1/auth/password/forgot', (route) => route.fulfill({ status: 202 }));

  await page.goto('/login');
  await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Esqueci minha senha' })).toBeVisible();
  await page.getByLabel('E-mail').fill('qualquer@exemplo.com');
  await page.getByRole('button', { name: 'Enviar link' }).click();

  await expect(page.getByTestId('forgot-sent')).toContainText(
    'Se houver uma conta com qualquer@exemplo.com',
  );
  await expect(page.getByTestId('forgot-sent')).toBeFocused();
});
