import { expect, test } from '@playwright/test';

test.describe('System status page', () => {
  test('shows every dependency as operational when the infrastructure is up', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('Status do sistema · TaskFlow');
    await expect(page.getByRole('heading', { level: 1, name: 'Status do sistema' })).toBeVisible();
    await expect(page.getByText('Todos os serviços estão operacionais.')).toBeVisible();

    const dependencies = page.getByRole('list', { name: 'Dependências' });
    await expect(dependencies.getByText('Banco de dados (PostgreSQL)')).toBeVisible();
    await expect(dependencies.getByText('Cache e filas (Redis)')).toBeVisible();
  });

  test('offers a skip link to the main content for keyboard users', async ({ page }) => {
    await page.goto('/');

    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: 'Pular para o conteúdo' });
    await expect(skipLink).toBeFocused();
  });
});
