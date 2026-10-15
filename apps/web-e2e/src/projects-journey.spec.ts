import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { inviteAndJoin, password, signUpAndCreateOrganization } from './support/accounts';
import { planDigestsNow } from './support/digests';
import { messagesTo, waitForEmail } from './support/mailpit';

// CA-10 das specs 003, 004, 005, 008 e 010: jornada real — web, API, worker e Mailpit, sem simulações.
// Grava dados: rode contra um banco descartável (docs/development/testing.md). As
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

  await test.step('spec 010: comment with a mention, edit, moderation and a canceled task', async () => {
    const projectUrl = `/o/${organization.slug}/projects/PDC`;
    const conversation = (page: Page) => page.getByRole('region', { name: /^Comentários/ });
    const composer = (page: Page) => page.getByRole('combobox', { name: 'Novo comentário' });

    // Owner cria a tarefa e comenta mencionando o membro pelo teclado (RF-03, RF-08)
    await ownerPage.goto(`${projectUrl}/tasks`);
    await ownerPage.getByRole('button', { name: 'Nova tarefa' }).click();
    await ownerPage.getByLabel('Título').fill('Revisar textos');
    await ownerPage.getByRole('button', { name: 'Criar tarefa' }).click();
    await expect(ownerPage.getByText('Tarefa PDC-5 criada.')).toBeAttached();
    await ownerPage.goto(`${projectUrl}/tasks/5`);
    await expect(conversation(ownerPage)).toContainText('Nenhum comentário ainda.');
    await composer(ownerPage).pressSequentially('Pode revisar, @Membro');
    await expect(
      ownerPage
        .getByRole('listbox', { name: 'Pessoas para mencionar' })
        .getByRole('option', { name: /Membro Projetos/ }),
    ).toBeVisible();
    await composer(ownerPage).press('Enter');
    await expect(composer(ownerPage)).toHaveValue('Pode revisar, @Membro Projetos ');
    await conversation(ownerPage).getByRole('button', { name: 'Comentar' }).click();
    await expect(ownerPage.getByText('Comentário enviado.')).toBeAttached();
    await expect(conversation(ownerPage)).toContainText('Pode revisar, @Membro Projetos');

    // Owner edita o próprio comentário mantendo a menção (RF-04)
    await conversation(ownerPage).getByRole('button', { name: 'Editar' }).click();
    const editor = ownerPage.getByRole('combobox', { name: 'Editar comentário' });
    await expect(editor).toHaveValue('Pode revisar, @Membro Projetos');
    await editor.press('End');
    await editor.pressSequentially(' até amanhã?');
    await conversation(ownerPage).getByRole('button', { name: 'Salvar' }).click();
    await expect(ownerPage.getByText('Comentário atualizado.')).toBeAttached();
    await expect(conversation(ownerPage)).toContainText('@Membro Projetos até amanhã?');
    await expect(conversation(ownerPage)).toContainText('(editado)');

    // O membro responde; não pode editar nem excluir o comentário do owner
    await guestPage.goto(`${projectUrl}/tasks/5`);
    await expect(conversation(guestPage)).toContainText('@Membro Projetos até amanhã?');
    await composer(guestPage).fill('Vou ver hoje.');
    await conversation(guestPage).getByRole('button', { name: 'Comentar' }).click();
    await expect(guestPage.getByText('Comentário enviado.')).toBeAttached();
    const guestItems = conversation(guestPage).getByRole('listitem');
    await expect(guestItems.first().getByRole('button')).toHaveCount(0);
    await expect(guestItems.last().getByRole('button', { name: 'Excluir' })).toBeVisible();

    // Owner (gerente efetivo) modera o comentário do membro (RF-05)
    await ownerPage.reload();
    const ownerItems = conversation(ownerPage).getByRole('listitem');
    await ownerItems.last().getByRole('button', { name: 'Excluir' }).click();
    await ownerPage.getByRole('button', { name: 'Excluir comentário' }).click();
    await expect(ownerPage.getByText('Comentário removido.')).toBeAttached();
    await expect(ownerItems.last()).toContainText('Comentário removido');

    // Tarefa cancelada: sem composer nem editar; excluir continua (decisão 9)
    await ownerPage.getByRole('button', { name: 'Cancelar tarefa' }).click();
    await expect(ownerPage.getByText('Tarefa cancelada.')).toBeAttached();
    await expect(conversation(ownerPage)).toContainText(
      'A tarefa está cancelada: reabra-a para comentar.',
    );
    await expect(composer(ownerPage)).toHaveCount(0);
    await expect(conversation(ownerPage).getByRole('button', { name: 'Editar' })).toHaveCount(0);
    await expect(ownerItems.first().getByRole('button', { name: 'Excluir' })).toBeVisible();
  });

  await test.step('spec 008: assignment and mention become notifications and an email digest', async () => {
    const bell = guestPage.getByRole('link', { name: /^Notificações/ });

    // O membro recebeu PDC-1 (atribuição) e foi mencionado em PDC-5: o worker registrou as duas
    await expect(async () => {
      await guestPage.goto(`/o/${organization.slug}`);
      await expect(bell).toHaveAccessibleName('Notificações, 2 não lidas', { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    // Resumo por e-mail: só contagens, chaves e links — sem nomes, títulos nem texto (decisões 7 e 8)
    // O agendador real também pode ter rodado no minuto zero: confere a soma de todos os resumos.
    await planDigestsNow();
    await waitForEmail(guest.email, 'Você tem novidades no TaskFlow');
    const digests = (await messagesTo(guest.email)).filter(
      (message) => message.Subject === 'Você tem novidades no TaskFlow',
    );
    const digest = {
      Text: digests.map((message) => message.Text).join('\n'),
      HTML: digests.map((message) => message.HTML).join('\n'),
    };
    if (digests.length === 1) {
      expect(digest.Text).toContain(
        `Na organização ${organization.slug}: 1 menção e 1 atribuição.`,
      );
    }
    expect(digest.Text).toContain(`/o/${organization.slug}/projects/PDC/tasks/1`);
    expect(digest.Text).toContain(`/o/${organization.slug}/projects/PDC/tasks/5`);
    expect(digest.Text).toContain('/account/notifications');
    for (const secret of [
      owner.name,
      'Login com SSO',
      'Revisar textos',
      'até amanhã',
      organization.name,
    ]) {
      expect(digest.Text).not.toContain(secret);
      expect(digest.HTML).not.toContain(secret);
    }

    // CA-09: a lista mostra as duas; abrir a atribuição leva à tarefa e a marca como lida
    await bell.click();
    await expect(guestPage).toHaveURL(new RegExp(`/o/${organization.slug}/notifications$`));
    const items = guestPage.getByRole('link', { name: /PDC-\d/ });
    await expect(items).toHaveCount(2);
    await expect(items.first()).toContainText('Dona Projetos mencionou você em PDC-5');
    await guestPage.getByRole('link', { name: /atribuiu a você PDC-1/ }).click();
    await expect(guestPage).toHaveURL(new RegExp(`/o/${organization.slug}/projects/PDC/tasks/1$`));
    await expect(bell).toHaveAccessibleName('Notificações, 1 não lida');

    // Preferência na conta: desliga o resumo por e-mail e continua desligado ao voltar
    await guestPage.goto('/account/notifications');
    const digestSwitch = guestPage.getByRole('switch', { name: 'Receber resumo por e-mail' });
    await expect(digestSwitch).toBeChecked();
    await digestSwitch.uncheck();
    await expect(guestPage.getByText('Resumo por e-mail desligado.')).toBeAttached();
    await guestPage.reload();
    await expect(digestSwitch).not.toBeChecked();
  });
});
