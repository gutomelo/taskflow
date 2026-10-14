import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { inviteAndJoin, password, signUpAndCreateOrganization } from './support/accounts';

// CA-10 (spec 003, T13) e CA-10 (spec 004, T13): jornada real — web, API, worker e Mailpit, sem
// simulações. Grava dados: rode contra um banco descartável (docs/development/testing.md). As
// tarefas continuam a jornada de projetos com as mesmas contas: a suíte já faz os 5 cadastros que o
// limite por IP permite.

const projectList = (page: Page) => page.getByRole('list', { name: 'Projetos' });
const participants = (page: Page) => page.getByRole('list', { name: 'Participantes do projeto' });
/** Navegação da área do projeto (a da organização também tem "Configurações"). */
const projectSection = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Seções do projeto' }).getByRole('link', { name });

test('CA-10: create a project, add a participant, archive and restore; then its tasks (spec 004)', async ({
  browser,
}) => {
  // Jornada longa (projetos e tarefas com as mesmas contas): mais que os 30 s padrão.
  test.setTimeout(180_000);
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

  await test.step('spec 004: task, assignee, required subtask and BR-001', async () => {
    const tasksUrl = `/o/${organization.slug}/projects/PDC/tasks`;
    const moveTo = (page: Page, status: string) =>
      page.getByRole('button', { name: `Mover para ${status}` }).click();

    // Owner (gerente efetivo) cria a tarefa na aba "Tarefas" (RF-01, BR-028)
    await ownerPage.goto(`/o/${organization.slug}/projects/PDC`);
    await projectSection(ownerPage, 'Tarefas').click();
    await ownerPage.getByRole('button', { name: 'Nova tarefa' }).click();
    await ownerPage.getByLabel('Título').fill('Login com SSO');
    await ownerPage.getByRole('button', { name: 'Criar tarefa' }).click();
    await expect(ownerPage.getByText('Tarefa PDC-1 criada.')).toBeAttached();
    await ownerPage
      .getByRole('list', { name: 'Tarefas do projeto' })
      .getByRole('link', { name: /PDC-1/ })
      .click();
    await expect(ownerPage).toHaveURL(new RegExp(`${tasksUrl}/1$`));

    // Atribui ao membro, entre os elegíveis da API (RF-06, BR-003)
    await ownerPage
      .getByRole('region', { name: 'Responsável' })
      .getByRole('combobox')
      .selectOption({ label: guest.name });
    await ownerPage.getByRole('button', { name: 'Salvar responsável' }).click();
    await expect(ownerPage.getByText('Responsável atualizado.')).toBeAttached();

    // Subtarefa obrigatória (RF-02)
    await ownerPage.getByRole('button', { name: 'Nova subtarefa' }).click();
    const subtaskForm = ownerPage.getByRole('form', { name: 'Nova subtarefa' });
    await subtaskForm.getByLabel('Título').fill('Revisar segurança');
    await subtaskForm.getByLabel('Obrigatória para concluir a tarefa').check();
    await subtaskForm.getByRole('button', { name: 'Criar subtarefa' }).click();
    await expect(ownerPage.getByRole('list', { name: 'Subtarefas' })).toContainText('PDC-2');

    // BR-001: o pai não conclui com a obrigatória pendente; a mensagem cita a subtarefa
    await moveTo(ownerPage, 'Em andamento');
    await expect(ownerPage.getByRole('heading', { name: 'Status: Em andamento' })).toBeVisible();
    await moveTo(ownerPage, 'Concluído');
    await expect(ownerPage.getByRole('alert')).toContainText(
      'Conclua ou cancele as subtarefas obrigatórias pendentes: PDC-2.',
    );

    // Conclui a subtarefa e depois o pai
    await ownerPage
      .getByRole('list', { name: 'Subtarefas' })
      .getByRole('link', { name: /PDC-2/ })
      .click();
    await expect(ownerPage).toHaveURL(new RegExp(`${tasksUrl}/2$`));
    await moveTo(ownerPage, 'Em andamento');
    await expect(ownerPage.getByRole('heading', { name: 'Status: Em andamento' })).toBeVisible();
    await moveTo(ownerPage, 'Concluído');
    await expect(ownerPage.getByRole('heading', { name: 'Status: Concluído' })).toBeVisible();
    await ownerPage.goto(`${tasksUrl}/1`);
    await moveTo(ownerPage, 'Concluído');
    await expect(ownerPage.getByRole('heading', { name: 'Status: Concluído' })).toBeVisible();

    // O membro vê a tarefa atribuída a ele; ações só com capacidade da API (D5: não exclui a alheia)
    await guestPage.goto(tasksUrl);
    await guestPage.getByLabel('Responsável').selectOption('me');
    const mine = guestPage.getByRole('list', { name: 'Tarefas do projeto' });
    await expect(mine).toContainText('Login com SSO');
    await mine.getByRole('link', { name: /PDC-1/ }).click();
    await expect(guestPage.getByRole('heading', { name: 'Status: Concluído' })).toBeVisible();
    await expect(guestPage.getByRole('button', { name: 'Mover para Em andamento' })).toBeVisible();
    await expect(guestPage.getByRole('button', { name: 'Excluir tarefa' })).toHaveCount(0);
  });

  await test.step('spec 005: workflow column, board moves and BR-001 on the board', async () => {
    const projectUrl = `/o/${organization.slug}/projects/PDC`;
    const board = () => ownerPage.getByRole('region', { name: /^Em revisão,/ });
    const cardAction = async (key: string, action: string) => {
      await ownerPage.getByRole('button', { name: `Mover ${key}` }).click();
      await ownerPage.getByRole('button', { name: action }).click();
    };

    // Gerente cria a coluna "Em revisão" e as transições Em andamento → Em revisão → Concluído
    await ownerPage.goto(projectUrl);
    await projectSection(ownerPage, 'Configurações').click();
    const newStatus = ownerPage.getByRole('form', { name: 'Novo status' });
    await newStatus.getByLabel('Nome do status').fill('Em revisão');
    await newStatus.getByRole('combobox').selectOption('in_progress');
    await newStatus.getByRole('button', { name: 'Criar status' }).click();
    await expect(ownerPage.getByLabel('Nome de Em revisão')).toBeVisible();
    await ownerPage.getByLabel('De Em andamento para Em revisão').check();
    await ownerPage.getByLabel('De Em revisão para Concluído').check();
    await ownerPage.getByRole('button', { name: 'Salvar transições' }).click();
    await expect(ownerPage.getByText('Fluxo atualizado.')).toBeAttached();

    // Tarefa com subtarefa obrigatória
    await projectSection(ownerPage, 'Tarefas').click();
    await ownerPage.getByRole('button', { name: 'Nova tarefa' }).click();
    await ownerPage.getByLabel('Título').fill('Deploy');
    await ownerPage.getByRole('button', { name: 'Criar tarefa' }).click();
    await expect(ownerPage.getByText('Tarefa PDC-3 criada.')).toBeAttached();
    await ownerPage.goto(`${projectUrl}/tasks/3`);
    await ownerPage.getByRole('button', { name: 'Nova subtarefa' }).click();
    const subtaskForm = ownerPage.getByRole('form', { name: 'Nova subtarefa' });
    await subtaskForm.getByLabel('Título').fill('Checklist de deploy');
    await subtaskForm.getByLabel('Obrigatória para concluir a tarefa').check();
    await subtaskForm.getByRole('button', { name: 'Criar subtarefa' }).click();
    await expect(ownerPage.getByRole('list', { name: 'Subtarefas' })).toContainText('PDC-4');

    // Quadro: a coluna nova aparece; o card anda pelo teclado e a conclusão é recusada (BR-001)
    await projectSection(ownerPage, 'Quadro').click();
    await expect(board()).toBeVisible();
    await cardAction('PDC-3', 'Para Em andamento');
    await expect(ownerPage.getByText('PDC-3 movida para Em andamento.')).toBeAttached();
    await cardAction('PDC-3', 'Para Em revisão');
    await expect(board()).toContainText('PDC-3');
    await cardAction('PDC-3', 'Para Concluído');
    await expect(ownerPage.getByRole('alert')).toContainText(
      'Conclua ou cancele as subtarefas obrigatórias pendentes antes de concluir.',
    );
    await expect(board()).toContainText('PDC-3');

    // Conclui a subtarefa pelo detalhe; agora o card conclui no quadro
    await ownerPage.goto(`${projectUrl}/tasks/4`);
    await ownerPage.getByRole('button', { name: 'Mover para Em andamento' }).click();
    await expect(ownerPage.getByRole('heading', { name: 'Status: Em andamento' })).toBeVisible();
    await ownerPage.getByRole('button', { name: 'Mover para Concluído' }).click();
    await expect(ownerPage.getByRole('heading', { name: 'Status: Concluído' })).toBeVisible();
    await ownerPage.goto(`${projectUrl}/board`);
    await cardAction('PDC-3', 'Para Concluído');
    await expect(ownerPage.getByRole('region', { name: /^Concluído,/ })).toContainText('PDC-3');
  });
});
