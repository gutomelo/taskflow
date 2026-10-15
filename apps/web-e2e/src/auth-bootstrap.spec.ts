import { expect, test } from '@playwright/test';

// T24: o bootstrap emite o cookie CSRF e resolve a sessão antes da primeira navegação.
test.describe('Auth bootstrap', () => {
  test('an anonymous visitor gets the CSRF cookie and the app opens without redirects', async ({
    page,
    context,
  }) => {
    const authCalls: string[] = [];
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith('/api/v1/'))
        authCalls.push(`${url.pathname} ${response.status()}`);
    });

    await page.goto('/status');
    await expect(page.getByRole('heading', { level: 1, name: 'Status do sistema' })).toBeVisible();

    // Sem sessão: /me responde 401, o interceptor tenta renovar uma vez e desiste em silêncio.
    expect(authCalls).toEqual([
      '/api/v1/auth/csrf 204',
      '/api/v1/me 401',
      '/api/v1/auth/refresh 401',
    ]);
    await expect(page).toHaveURL(/\/status$/);

    const csrf = (await context.cookies()).find((cookie) => cookie.name === '__Host-tf_csrf');
    expect(csrf).toMatchObject({ path: '/', secure: true, httpOnly: false, sameSite: 'Strict' });
    // Nenhum token de sessão é acessível ao JavaScript da página.
    const visibleCookies = await page.evaluate(() => document.cookie);
    expect(visibleCookies).not.toMatch(/tf_at|tf_rt/);
  });
});
