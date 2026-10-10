import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { linkIn, waitForEmail } from './support/mailpit';

// CA-11 (spec 002, T22): jornada real — web, API, worker e Mailpit, sem simulações. Grava dados:
// rode contra um banco descartável (docs/development/testing.md).

const password = () => `Jornada-${randomUUID().slice(0, 8)}-9`;

/** Confirma o e-mail pelo link do Mailpit, entrando na conta no caminho (BR-017). */
async function confirmEmail(page: Page, email: string, secret: string): Promise<void> {
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

async function register(page: Page, name: string, email: string, secret: string): Promise<void> {
  await page.getByLabel('Nome').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(secret);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Confira seu e-mail' })).toBeVisible();
}

const membersList = (page: Page) => page.getByRole('list', { name: 'Membros da organização' });
const memberRow = (page: Page, name: string) =>
  membersList(page).getByRole('listitem').filter({ hasText: name });

test('CA-11: create an organization, invite by e-mail, accept, change the role and leave', async ({
  browser,
}) => {
  const id = randomUUID().slice(0, 8);
  const ownerEmail = `e2e-owner-${id}@exemplo.com`;
  const guestEmail = `e2e-guest-${id}@exemplo.com`;
  const [ownerSecret, guestSecret] = [password(), password()];
  const slug = `e2e-${id}`;
  const owner = await (await browser.newContext()).newPage();
  const guest = await (await browser.newContext()).newPage();

  // Owner: cadastro, confirmação e onboarding (CA-01, CA-10)
  await owner.goto('/register');
  await register(owner, 'Dona E2E', ownerEmail, ownerSecret);
  await confirmEmail(owner, ownerEmail, ownerSecret);
  await owner.getByRole('link', { name: 'Continuar' }).click();
  await expect(
    owner.getByRole('heading', { level: 1, name: 'Crie sua organização' }),
  ).toBeVisible();
  await owner.getByLabel('Nome da organização').fill(`Acme ${id}`);
  await owner.getByLabel('Endereço').fill(slug);
  await owner.getByRole('button', { name: 'Criar organização' }).click();
  await expect(owner).toHaveURL(new RegExp(`/o/${slug}$`));
  await expect(owner.getByText(`Você está em “Acme ${id}” como proprietário(a).`)).toBeVisible();

  // Owner convida (RF-06)
  await owner.getByRole('link', { name: 'Membros' }).click();
  await owner.getByRole('textbox', { name: 'E-mail' }).fill(guestEmail);
  await owner.getByRole('button', { name: 'Convidar' }).click();
  await expect(owner.getByRole('list', { name: 'Convites pendentes' })).toContainText(guestEmail);

  // Convite entregue pelo worker, com o link no fragmento (CA-04, RNF-08)
  const invitationEmail = await waitForEmail(
    guestEmail,
    `Convite para a organização “Acme ${id}” no TaskFlow`,
  );
  expect(invitationEmail.Text).toContain(
    `“Dona E2E” convidou você para a organização “Acme ${id}”`,
  );
  expect(invitationEmail.Text).toContain('Se você não esperava este convite, ignore este e-mail.');
  const invitationLink = linkIn(invitationEmail, '/invitations/accept');

  // Convidado sem conta: o link leva ao cadastro, sem o token em URL nenhuma
  await guest.goto(invitationLink);
  await expect(guest.getByTestId('accept-state')).toHaveAttribute('data-state', 'needs_login');
  expect(guest.url()).not.toContain('token=');
  await guest.getByRole('link', { name: 'Criar conta' }).click();
  expect(guest.url()).not.toContain('token=');
  await register(guest, 'Convidado E2E', guestEmail, guestSecret);
  await confirmEmail(guest, guestEmail, guestSecret);

  // A aba saiu do SPA para confirmar o e-mail: o link do convite é aberto de novo (7 dias)
  await guest.goto(invitationLink);
  await expect(guest.getByTestId('accept-state')).toHaveAttribute('data-state', 'ready');
  await expect(
    guest.getByText(`para a organização “Acme ${id}”, com o papel de membro.`),
  ).toBeVisible();
  await guest.getByRole('button', { name: 'Aceitar convite' }).click();
  await expect(guest).toHaveURL(new RegExp(`/o/${slug}$`));

  // Aparece na lista de membros; o owner altera o papel (RF-10)
  await owner.reload();
  await expect(memberRow(owner, 'Convidado E2E')).toContainText(guestEmail);
  await memberRow(owner, 'Convidado E2E')
    .getByLabel('Papel de Convidado E2E')
    .selectOption('admin');
  await memberRow(owner, 'Convidado E2E').getByRole('button', { name: 'Salvar papel' }).click();
  await expect(owner.getByText('Convidado E2E agora é administrador(a).')).toBeAttached();

  // O convidado vê o novo papel e sai (RF-12)
  await guest.goto(`/o/${slug}/members`);
  await expect(memberRow(guest, 'Convidado E2E')).toBeVisible();
  await expect(guest.getByRole('heading', { level: 2, name: 'Convites' })).toBeVisible();
  await memberRow(guest, 'Convidado E2E')
    .getByRole('button', { name: 'Sair da organização' })
    .click();
  await memberRow(guest, 'Convidado E2E').getByRole('button', { name: 'Confirmar' }).click();
  await expect(guest).toHaveURL(/\/organizations$/);

  // Isolamento pela interface (CA-03, CA-09): a URL da organização já não abre nada
  await guest.goto(`/o/${slug}/members`);
  await expect(guest).toHaveURL(/\/organizations$/);
  await expect(guest.getByRole('alert')).toContainText('Organização não encontrada');
  await owner.reload();
  await expect(memberRow(owner, 'Convidado E2E')).toHaveCount(0);
});
