import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { linkIn, waitForEmail } from './mailpit';

// Passos reais de conta e convite (web, API, worker e Mailpit), compartilhados pelas jornadas.

export const password = () => `Jornada-${randomUUID().slice(0, 8)}-9`;

/** Confirma o e-mail pelo link do Mailpit, entrando na conta no caminho (BR-017). */
export async function confirmEmail(page: Page, email: string, secret: string): Promise<void> {
  const verification = await waitForEmail(email, 'Confirme seu e-mail no TaskFlow');
  await page.goto(linkIn(verification, '/verify-email'));
  await page.getByRole('button', { name: 'Entrar para confirmar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar no TaskFlow' })).toBeVisible();
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('button', { name: 'Confirmar e-mail' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'E-mail confirmado' })).toBeVisible();
}

export async function register(
  page: Page,
  name: string,
  email: string,
  secret: string,
): Promise<void> {
  await page.getByLabel('Nome').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Confira seu e-mail' })).toBeVisible();
}

/** Cadastro, confirmação e onboarding: a pessoa termina como owner da organização nova. */
export async function signUpAndCreateOrganization(
  page: Page,
  person: Readonly<{ name: string; email: string; secret: string }>,
  organization: Readonly<{ name: string; slug: string }>,
): Promise<void> {
  await page.goto('/register');
  await register(page, person.name, person.email, person.secret);
  await confirmEmail(page, person.email, person.secret);
  await page.getByRole('link', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Crie sua organização' })).toBeVisible();
  await page.getByLabel('Nome da organização').fill(organization.name);
  await page.getByLabel('Endereço').fill(organization.slug);
  await page.getByRole('button', { name: 'Criar organização' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${organization.slug}$`));
}

/**
 * O owner convida pelo e-mail e a pessoa convidada (sem conta) se cadastra, confirma e aceita: termina
 * como `member` da organização.
 */
export async function inviteAndJoin(
  owner: Page,
  guest: Page,
  person: Readonly<{ name: string; email: string; secret: string }>,
  organization: Readonly<{ name: string; slug: string }>,
): Promise<void> {
  await owner.goto(`/o/${organization.slug}/members`);
  await owner.getByRole('textbox', { name: 'E-mail' }).fill(person.email);
  await owner.getByRole('button', { name: 'Convidar' }).click();
  await expect(owner.getByRole('list', { name: 'Convites pendentes' })).toContainText(person.email);
  const invitation = await waitForEmail(
    person.email,
    `Convite para a organização “${organization.name}” no TaskFlow`,
  );
  const link = linkIn(invitation, '/invitations/accept');
  await guest.goto(link);
  await guest.getByRole('link', { name: 'Criar conta' }).click();
  await register(guest, person.name, person.email, person.secret);
  await confirmEmail(guest, person.email, person.secret);
  await guest.goto(link);
  await guest.getByRole('button', { name: 'Aceitar convite' }).click();
  await expect(guest).toHaveURL(new RegExp(`/o/${organization.slug}$`));
}
