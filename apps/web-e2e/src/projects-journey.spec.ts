import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { inviteAndJoin, password, signUpAndCreateOrganization } from './support/accounts';

// CA-10 (spec 003, T13): jornada real — web, API, worker e Mailpit, sem simulações. Grava dados:
// rode contra um banco descartável (docs/development/testing.md).

const projectList = (page: Page) => page.getByRole('list', { name: 'Projetos' });
const participants = (page: Page) => page.getByRole('list', { name: 'Participantes do projeto' });
/** Navegação da área do projeto (a da organização também tem "Configurações"). */
const projectSection = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Seções do projeto' }).getByRole('link', { name });

test('CA-10: create a project, add a participant, archive and restore', async ({ browser }) => {
  const id = randomUUID().slice(0, 8);
  const organization = { name: `Acme ${id}`, slug: `e2e-p-${id}` };
  const owner = {
    name: 'Dona Projetos',
    email: `e2e-powner-${id}@exemplo.com`,
    secret: password(),
  };
  const guest = {
    name: 'Membro Projetos',
    email: `e2e-pmember-${id}@exemplo.com`,
    secret: password(),
  };
  const ownerPage = await (await browser.newContext()).newPage();
  const guestPage = await (await browser.newContext()).newPage();

  await signUpAndCreateOrganization(ownerPage, owner, organization);
  await inviteAndJoin(ownerPage, guestPage, guest, organization);

  // O membro ainda não participa de nenhum projeto (BR-023)
  await guestPage.goto(`/o/${organization.slug}/projects`);
  await expect(guestPage.getByText('Nenhum projeto ativo por aqui ainda.')).toBeVisible();

  // Owner cria o projeto; a chave é sugerida pelo nome (RF-01, BR-025)
  await ownerPage.getByRole('link', { name: 'Projetos' }).click();
  await ownerPage.getByRole('link', { name: 'Novo projeto' }).click();
  await ownerPage.getByLabel('Nome do projeto').fill('Portal do Cliente');
  await expect(ownerPage.getByLabel('Chave')).toHaveValue('PDC');
  await ownerPage.getByRole('button', { name: 'Criar projeto' }).click();
  await expect(ownerPage).toHaveURL(new RegExp(`/o/${organization.slug}/projects/PDC$`));
  await expect(ownerPage.getByRole('heading', { level: 1 })).toContainText('Portal do Cliente');
  await expect(ownerPage.getByText('A fazer → Em andamento')).toBeVisible();

  // Owner adiciona o membro como participante (RF-07)
  await projectSection(ownerPage, 'Participantes').click();
  await ownerPage.getByLabel('Pessoa').selectOption({ label: `${guest.name} (${guest.email})` });
  await ownerPage.getByLabel('Papel no projeto').selectOption('member');
  await ownerPage.getByRole('button', { name: 'Adicionar' }).click();
  await expect(participants(ownerPage)).toContainText(guest.email);

  // Agora o membro vê e abre o projeto
  await guestPage.reload();
  await projectList(guestPage)
    .getByRole('link', { name: /Portal do Cliente/ })
    .click();
  await expect(guestPage).toHaveURL(new RegExp(`/o/${organization.slug}/projects/PDC$`));

  // Owner arquiva (BR-026): sai da lista padrão e aparece em "Arquivados"
  await projectSection(ownerPage, 'Configurações').click();
  await ownerPage.getByRole('button', { name: 'Arquivar' }).click();
  await ownerPage.getByRole('button', { name: 'Confirmar' }).click();
  await expect(ownerPage.getByText('Projeto arquivado.')).toBeAttached();
  await expect(ownerPage.getByText('Este projeto está arquivado')).toBeVisible();
  await ownerPage.goto(`/o/${organization.slug}/projects`);
  await expect(ownerPage.getByText('Nenhum projeto ativo por aqui ainda.')).toBeVisible();
  await ownerPage.getByRole('button', { name: 'Arquivados' }).click();
  await projectList(ownerPage)
    .getByRole('link', { name: /Portal do Cliente/ })
    .click();

  // E restaura
  await projectSection(ownerPage, 'Configurações').click();
  await ownerPage.getByRole('button', { name: 'Restaurar' }).click();
  await expect(ownerPage.getByText('Projeto restaurado.')).toBeAttached();
  await ownerPage.goto(`/o/${organization.slug}/projects`);
  await expect(projectList(ownerPage)).toContainText('Portal do Cliente');
});
