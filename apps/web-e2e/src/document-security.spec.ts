import { expect, test } from '@playwright/test';

// Spec 001 (design § Segurança, T23): CSP sem origens de terceiros, nonce por resposta e
// Referrer-Policy no-referrer — o token de e-mail no fragmento não vaza via Referer.
test.describe('SPA document security', () => {
  test('serves the document with a strict CSP and no-referrer policy', async ({ page }) => {
    const response = await page.goto('/status');

    const headers = response?.headers() ?? {};
    expect(headers['referrer-policy']).toBe('no-referrer');
    const csp = headers['content-security-policy'] ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9_+/=-]+'/);
    expect(csp).toMatch(/style-src 'self' 'nonce-[A-Za-z0-9_+/=-]+'/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toMatch(/https?:/);
  });

  test('renders without CSP violations, with component styles and the self-hosted font', async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('Content Security Policy')) violations.push(message.text());
    });
    const requestedUrls: string[] = [];
    page.on('request', (request) => requestedUrls.push(request.url()));

    await page.goto('/status');
    await expect(page.getByRole('heading', { level: 1, name: 'Status do sistema' })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    expect(violations).toEqual([]);
    const appOrigin = new URL(page.url()).origin;
    expect(requestedUrls.filter((url) => new URL(url).origin !== appOrigin)).toEqual([]);
    // A fonte vem da própria origem e foi de fato carregada (não basta o nome no CSS:
    // `document.fonts.check` é verdadeiro mesmo sem nenhum @font-face correspondente).
    const loadedInterFaces = await page.evaluate(
      () =>
        [...document.fonts].filter(
          (face) =>
            face.family.replaceAll('"', '') === 'Inter Variable' && face.status === 'loaded',
        ).length,
    );
    expect(loadedInterFaces).toBeGreaterThan(0);
    expect(requestedUrls.some((url) => url.startsWith(appOrigin) && url.endsWith('.woff2'))).toBe(
      true,
    );
    const fontFamily = await page
      .getByRole('heading', { level: 1 })
      .evaluate((element) => getComputedStyle(element).fontFamily);
    expect(fontFamily).toContain('Inter Variable');
  });

  test('applies styles injected at runtime by Angular components under the nonce', async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('Content Security Policy')) violations.push(message.text());
    });
    // Estado degradado: renderiza o MatButton, cujos estilos o Angular injeta em runtime.
    await page.route('**/health/ready', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'not_ready',
          checks: [
            { name: 'postgres', status: 'up', latencyMs: 1 },
            { name: 'redis', status: 'down', latencyMs: 2000 },
          ],
        }),
      }),
    );

    await page.goto('/status');
    const retry = page.getByRole('button', { name: 'Tentar novamente' });
    await expect(retry).toBeVisible();

    expect(violations).toEqual([]);
    const nonce = await page.locator('tf-root').getAttribute('ngCspNonce');
    const injected = await page.evaluate(
      (expected) =>
        [...document.querySelectorAll('style')].filter((style) => style.nonce === expected).length,
      nonce,
    );
    expect(injected).toBeGreaterThan(0);
    // `inline-flex` vem do CSS do Material injetado; bloqueado pela CSP, o botão ficaria `inline-block`.
    expect(await retry.evaluate((element) => getComputedStyle(element).display)).toBe(
      'inline-flex',
    );
  });

  test('redirects the root and unknown paths to the status page until the home exists', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/status$/);
    await page.goto('/nao-existe');
    await expect(page).toHaveURL(/\/status$/);
  });
});
