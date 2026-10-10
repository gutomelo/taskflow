import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { linkIn, waitForEmail } from './support/mailpit';

// CA-14: jornada real — web, API, worker (outbox → BullMQ → SMTP) e Mailpit, sem simulações.
// Grava um usuário de verdade: rode contra um banco descartável (docs/development/testing.md).
test('CA-14: register, confirm by e-mail, sign in, see the session and sign out', async ({
  page,
}) => {
  const email = `e2e-${randomUUID()}@exemplo.com`;
  const password = `Jornada-${randomUUID().slice(0, 8)}-9`;

  // Cadastro
  await page.goto('/register');
  await page.getByLabel('Nome').fill('Pessoa E2E');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Confira seu e-mail' })).toBeVisible();

  // E-mail entregue pelo worker ao Mailpit, com o token no fragmento do link
  const verification = await waitForEmail(email, 'Confirme seu e-mail no TaskFlow');
  expect(verification.Text).toContain('Olá!'); // conta não verificada: saudação genérica
  const link = linkIn(verification, '/verify-email');

  // Link sem sessão: pede login e não confirma nada (BR-017)
  await page.goto(link);
  await expect(page.getByTestId('verify-email-state')).toHaveAttribute('data-state', 'needs_login');
  expect(page.url()).not.toContain('token=');
  await page.getByRole('button', { name: 'Entrar para confirmar' }).click();
  // Espera o login renderizar: na transição, "Confirmar e-mail" (página anterior) também casaria.
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar no TaskFlow' })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();

  // De volta ao link: confirmação só com o clique
  await expect(page.getByTestId('verify-email-state')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: 'Confirmar e-mail' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E-mail confirmado' })).toBeVisible();

  // Conta nova sem organização: o início leva ao onboarding (spec 002, CA-10), sem o aviso
  await page.getByRole('link', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/organizations\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Crie sua organização' })).toBeVisible();
  await expect(page.getByTestId('verification-banner')).toHaveCount(0);

  // Segurança lista a sessão atual
  await page.getByRole('button', { name: 'Menu da conta de Pessoa E2E' }).click();
  await page.getByRole('menuitem', { name: 'Segurança da conta' }).click();
  const sessions = page.getByRole('list', { name: 'Sessões ativas' });
  await expect(sessions.getByRole('listitem')).toHaveCount(1);
  await expect(sessions.getByRole('listitem')).toContainText('Esta sessão');

  // Logout e rota protegida
  await page.getByRole('button', { name: 'Menu da conta de Pessoa E2E' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/account/security');
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Faccount%2Fsecurity$/);
});
