import { expect, test, type Page } from '@playwright/test';
import { mockMyOrganizations } from './support/organizations';

// T25: telas de login e cadastro no navegador real (CSP, Material, foco e requisitos de senha).
// Os envios usam respostas simuladas: o E2E roda contra o banco local de desenvolvimento.

function watchCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text());
  });
  return violations;
}

test.describe('Register page', () => {
  test('shows live password requirements and the confirmation after submitting', async ({
    page,
  }) => {
    const violations = watchCspViolations(page);
    await page.route('**/api/v1/auth/register', (route) => route.fulfill({ status: 202 }));

    await page.goto('/register');
    await expect(page).toHaveTitle('Criar conta · TaskFlow');
    await page.getByLabel('Nome').fill('Ana Souza');
    await page.getByLabel('E-mail').fill('ana@exemplo.com');
    const password = page.getByLabel('Senha', { exact: true });
    await password.fill('abc');

    const requirements = page.getByTestId('password-requirements');
    await expect(requirements.locator('[data-rule="uppercase"]')).toHaveAttribute(
      'data-met',
      'false',
    );
    await password.fill('Correct-Horse-9');
    await expect(requirements.locator('[data-met="false"]')).toHaveCount(0);
    await expect(page.getByTestId('password-requirements-live')).toHaveText(
      'Todos os requisitos de senha foram atendidos.',
    );

    await page.getByRole('button', { name: 'Criar conta' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Confira seu e-mail' })).toBeVisible();
    await expect(page.getByTestId('register-success')).toBeFocused();
    expect(violations).toEqual([]);
  });

  test('keeps a weak password on the client and focuses the field', async ({ page }) => {
    let registerCalls = 0;
    await page.route('**/api/v1/auth/register', (route) => {
      registerCalls += 1;
      return route.fulfill({ status: 202 });
    });

    await page.goto('/register');
    await page.getByLabel('Nome').fill('Ana Souza');
    await page.getByLabel('E-mail').fill('ana@exemplo.com');
    await page.getByLabel('Senha', { exact: true }).fill('fraca');
    await page.getByRole('button', { name: 'Criar conta' }).click();

    await expect(page.getByLabel('Senha', { exact: true })).toBeFocused();
    await expect(page.getByText('A senha ainda não atende a todos os requisitos.')).toBeVisible();
    expect(registerCalls).toBe(0);
  });
});

test.describe('Login page', () => {
  test('reports wrong credentials in an alert that receives focus', async ({ page }) => {
    const violations = watchCspViolations(page);
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: 'x',
          status: 401,
          code: 'INVALID_CREDENTIALS',
        }),
      }),
    );

    await page.goto('/login');
    await expect(page).toHaveTitle('Entrar · TaskFlow');
    await page.getByLabel('E-mail').fill('ana@exemplo.com');
    await page.getByLabel('Senha', { exact: true }).fill('Errada-123!');
    await page.getByRole('button', { name: 'Entrar' }).click();

    const alert = page.getByRole('alert');
    await expect(alert).toHaveText('E-mail ou senha incorretos.');
    await expect(alert).toBeFocused();
    await expect(page.getByLabel('Senha', { exact: true })).toHaveValue('');
    expect(violations).toEqual([]);
  });

  test('signs in and returns to the internal page that was requested', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: '01a11e1a-99fa-7501-a131-4ad99a122005',
          name: 'Ana',
          email: 'ana@exemplo.com',
          emailVerified: true,
        }),
      }),
    );
    await mockMyOrganizations(page);

    await page.goto('/login?returnUrl=%2Fstatus');
    await page.getByLabel('E-mail').fill('ana@exemplo.com');
    await page.getByLabel('Senha', { exact: true }).fill('Correct-Horse-9');
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page).toHaveURL(/\/status$/);
  });

  test('links to the registration page keeping the return URL', async ({ page }) => {
    await page.goto('/login?returnUrl=%2Fstatus');

    await page.getByRole('link', { name: 'Criar conta' }).click();

    await expect(page).toHaveURL(/\/register\?returnUrl=%2Fstatus$/);
  });
});
