import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { ProjectDto, TaskDto } from '@taskflow/contracts';
import { nextRequest } from '../../core/organizations/organizations.testing';
import { buttonIn, openProjectArea, PROJECT, problem, stable } from '../projects/projects.testing';
import {
  BIA,
  listUrl,
  STATUS,
  taskDto,
  tasksProject,
  taskSummary,
  TASKS,
  uuid,
  WORKFLOW,
} from './tasks.testing';

const ASSIGNABLE = `${TASKS}/assignable-users?projectId=${tasksProject().id}`;
const BY_KEY = (key: string) => `${TASKS}/by-key/${key}`;
const TASK = (task: { id: string }) => `${TASKS}/${task.id}`;

type Env = Awaited<ReturnType<typeof openProjectArea>>;

async function open(task: TaskDto, project: ProjectDto = tasksProject()): Promise<Env> {
  const env = await openProjectArea(`/tasks/${task.number}`, project);
  (await nextRequest(env.backend, BY_KEY(task.key))).flush(task);
  (await nextRequest(env.backend, `${PROJECT(project)}/workflow`)).flush(WORKFLOW);
  await stable(env.harness);
  if (task.actions.assign) {
    (await nextRequest(env.backend, ASSIGNABLE)).flush({
      items: [{ userId: BIA, name: 'Bia', email: 'bia@exemplo.com', effectiveRole: 'member' }],
      nextCursor: null,
    });
    await stable(env.harness);
  }
  return env;
}

const text = (env: Env) => env.root().textContent ?? '';
const alertText = (env: Env) =>
  [...env.root().querySelectorAll('[role="alert"]')]
    .map((element) => element.textContent)
    .join(' ');
const announced = (env: Env) => env.root().querySelector('[aria-live="polite"]')?.textContent ?? '';
const READ_ONLY: TaskDto['actions'] = {
  update: false,
  assign: false,
  cancel: false,
  reopen: false,
  delete: false,
  transitionTo: [],
};

function type(input: HTMLInputElement | null, value: string) {
  if (!input) throw new Error('missing input');
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('TaskDetailPage (RF-04 a RF-10, CA-10)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('shows the task with subtasks, both dependency directions and only the API transitions', async () => {
    const env = await open(
      taskDto(1, {
        subtasks: [taskSummary(2, { isRequired: true, parentTaskId: uuid('70001') })],
        blockedBy: [taskSummary(3)],
        blocking: [taskSummary(4)],
        blockingTruncated: true,
      }),
    );

    expect(text(env)).toContain('WEB-1');
    expect(text(env)).toContain('Status: A fazer');
    expect(buttonIn(env.root(), 'Mover para Em andamento')).toBeDefined();
    expect(buttonIn(env.root(), 'Mover para Concluído')).toBeUndefined();
    const subtasks = env.root().querySelector('ul[aria-label="Subtarefas"]');
    expect(subtasks?.textContent).toContain('WEB-2');
    expect(subtasks?.textContent).toContain('Obrigatória');
    expect(subtasks?.querySelector('a')?.getAttribute('href')).toBe('/o/acme/projects/WEB/tasks/2');
    expect(env.root().querySelector('ul[aria-label="Bloqueada por"]')?.textContent).toContain(
      'WEB-3',
    );
    expect(env.root().querySelector('ul[aria-label="Bloqueia"]')?.textContent).toContain('WEB-4');
    expect(text(env)).toContain('Mostrando as primeiras 50.');
  });

  it('CA-10: without capabilities the page is read-only (no form, no action buttons)', async () => {
    const env = await open(
      taskDto(1, { actions: READ_ONLY, description: 'Detalhe', blockedBy: [taskSummary(3)] }),
      tasksProject({ myRole: 'viewer', capabilities: ['project:read'] }),
    );

    expect(env.root().querySelector('form')).toBeNull();
    expect(text(env)).toContain('Detalhe');
    expect(text(env)).toContain('Nenhuma mudança de status disponível para você.');
    for (const label of [
      'Cancelar tarefa',
      'Excluir tarefa',
      'Nova subtarefa',
      'Salvar responsável',
    ]) {
      expect(buttonIn(env.root(), label), label).toBeUndefined();
    }
    expect(env.root().querySelector('button[aria-label^="Remover a dependência"]')).toBeNull();
  });

  it('moves the task with the version and announces it', async () => {
    const task = taskDto(1, { version: 4 });
    const env = await open(task);

    buttonIn(env.root(), 'Mover para Em andamento')?.click();
    const request = await nextRequest(env.backend, `${TASK(task)}/transition`);
    expect(request.request.body).toEqual({ statusId: STATUS.doing, version: 4 });
    request.flush(
      taskDto(1, {
        version: 2,
        status: { id: STATUS.doing, name: 'Em andamento', category: 'in_progress' },
        actions: { ...task.actions, transitionTo: [STATUS.todo, STATUS.done] },
      }),
    );
    await stable(env.harness);

    expect(text(env)).toContain('Status: Em andamento');
    expect(announced(env)).toContain('Status alterado para Em andamento.');
  });

  it('CA-10: completing the parent with a pending required subtask shows its key in a focused alert', async () => {
    const child = taskSummary(2, { isRequired: true });
    const task = taskDto(1, {
      status: { id: STATUS.doing, name: 'Em andamento', category: 'in_progress' },
      actions: { ...taskDto(1).actions, transitionTo: [STATUS.todo, STATUS.done] },
      subtasks: [child],
    });
    const env = await open(task);

    buttonIn(env.root(), 'Mover para Concluído')?.click();
    const [body, init] = problem('TASK_HAS_PENDING_REQUIRED_SUBTASKS', 422);
    (await nextRequest(env.backend, `${TASK(task)}/transition`)).flush(
      { ...body, taskIds: [child.id] },
      init,
    );
    await stable(env.harness);

    const alert = env.root().querySelector<HTMLElement>('p[role="alert"]');
    expect(alert?.textContent).toContain(
      'Conclua ou cancele as subtarefas obrigatórias pendentes: WEB-2.',
    );
    expect(document.activeElement).toBe(alert);
  });

  it('saves the details with the version; a conflict reloads the task and explains', async () => {
    const task = taskDto(1);
    const env = await open(task);
    type(env.root().querySelector('input[formcontrolname="title"]'), 'Novo título');
    const due = env.root().querySelector<HTMLInputElement>('input[type="date"]');
    type(due, '2026-12-24');

    buttonIn(env.root(), 'Salvar')?.click();
    const request = await nextRequest(env.backend, TASK(task));
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({
      title: 'Novo título',
      description: null,
      priority: 'none',
      dueDate: '2026-12-24',
      version: 1,
    });
    request.flush(...problem('VERSION_CONFLICT', 409));
    (await nextRequest(env.backend, BY_KEY('WEB-1'))).flush(
      taskDto(1, { version: 3, title: 'De outra pessoa' }),
    );
    await stable(env.harness);

    expect(alertText(env)).toContain('A tarefa foi alterada por outra pessoa.');
    expect(
      env.root().querySelector<HTMLInputElement>('input[formcontrolname="title"]')?.value,
    ).toBe('De outra pessoa');
  });

  it('assigns among the eligible people from the API', async () => {
    const task = taskDto(1);
    const env = await open(task);
    const select = env
      .root()
      .querySelector<HTMLSelectElement>('section[aria-labelledby="assignee-title"] select');
    expect([...(select?.options ?? [])].map((option) => option.textContent?.trim())).toEqual([
      'Sem responsável',
      'Bia',
    ]);
    if (select) {
      select.value = BIA;
      select.dispatchEvent(new Event('change'));
    }
    await stable(env.harness);

    buttonIn(env.root(), 'Salvar responsável')?.click();
    const request = await nextRequest(env.backend, `${TASK(task)}/assignee`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({ assigneeUserId: BIA, version: 1 });
    request.flush(taskDto(1, { version: 2, assignee: { userId: BIA, name: 'Bia' } }));
    await stable(env.harness);

    expect(announced(env)).toContain('Responsável atualizado.');
  });

  it('creates a required subtask under the task, then refreshes it', async () => {
    const task = taskDto(1);
    const env = await open(task);

    buttonIn(env.root(), 'Nova subtarefa')?.click();
    await stable(env.harness);
    const form = env.root().querySelector('form[aria-label="Nova subtarefa"]');
    type(form?.querySelector<HTMLInputElement>('input[formcontrolname="title"]') ?? null, 'Filha');
    const required = form?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    required?.click();
    buttonIn(form, 'Criar subtarefa')?.click();
    const create = await nextRequest(env.backend, TASKS);
    expect(create.request.body).toEqual({
      projectId: task.projectId,
      title: 'Filha',
      priority: 'none',
      parentTaskId: task.id,
      isRequired: true,
    });
    create.flush(taskDto(2, { title: 'Filha', parentTaskId: task.id, isRequired: true }));
    (await nextRequest(env.backend, BY_KEY('WEB-1'))).flush(
      taskDto(1, { subtasks: [taskSummary(2, { title: 'Filha', isRequired: true })] }),
    );
    await stable(env.harness);

    expect(env.root().querySelector('ul[aria-label="Subtarefas"]')?.textContent).toContain('Filha');
    expect(announced(env)).toContain('Subtarefa WEB-2 criada.');
  });

  it('following a subtask link opens that task (the page is recreated, never stale)', async () => {
    const env = await open(taskDto(1, { subtasks: [taskSummary(2, { isRequired: true })] }));

    env.root().querySelector<HTMLAnchorElement>('ul[aria-label="Subtarefas"] a')?.click();
    (await nextRequest(env.backend, BY_KEY('WEB-2'))).flush(
      taskDto(2, { title: 'A subtarefa', parentTaskId: taskDto(1).id }),
    );
    (await nextRequest(env.backend, `${PROJECT(tasksProject())}/workflow`)).flush(WORKFLOW);
    await stable(env.harness);
    (await nextRequest(env.backend, ASSIGNABLE)).flush({ items: [], nextCursor: null });
    await stable(env.harness);

    expect(TestBed.inject(Router).url).toBe('/o/acme/projects/WEB/tasks/2');
    expect(env.root().querySelector('h2')?.textContent).toContain('A subtarefa');
  });

  it('a subtask cannot get subtasks (one level)', async () => {
    const env = await open(taskDto(2, { parentTaskId: uuid('70001') }));

    expect(buttonIn(env.root(), 'Nova subtarefa')).toBeUndefined();
  });

  it('adds a blocker by key (validated first) and removes it', async () => {
    const task = taskDto(1);
    const env = await open(task);
    const input = env
      .root()
      .querySelector<HTMLInputElement>('section[aria-labelledby="blocked-by-title"] input');

    type(input, 'web 5');
    buttonIn(env.root(), 'Adicionar')?.click();
    await stable(env.harness);
    expect(text(env)).toContain('Informe uma chave como WEB-12.');

    type(input, 'web-5');
    buttonIn(env.root(), 'Adicionar')?.click();
    (await nextRequest(env.backend, BY_KEY('WEB-5'))).flush(taskDto(5));
    const add = await nextRequest(env.backend, `${TASK(task)}/dependencies`);
    expect(add.request.body).toEqual({ blockingTaskId: taskDto(5).id });
    add.flush(taskDto(1, { blockedBy: [taskSummary(5)] }), { status: 201, statusText: 'Created' });
    await stable(env.harness);
    expect(announced(env)).toContain('Agora bloqueada por WEB-5.');

    env
      .root()
      .querySelector<HTMLButtonElement>('button[aria-label="Remover a dependência de WEB-5"]')
      ?.click();
    const remove = await nextRequest(env.backend, `${TASK(task)}/dependencies/${taskDto(5).id}`);
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    (await nextRequest(env.backend, BY_KEY('WEB-1'))).flush(taskDto(1));
    await stable(env.harness);

    expect(text(env)).toContain('Nenhuma tarefa bloqueia esta.');
  });

  it('a blocker key that does not exist, or is of another project, is a field error (the task stays open)', async () => {
    const task = taskDto(1);
    const env = await open(task);
    const input = env
      .root()
      .querySelector<HTMLInputElement>('section[aria-labelledby="blocked-by-title"] input');

    type(input, 'WEB-999');
    buttonIn(env.root(), 'Adicionar')?.click();
    (await nextRequest(env.backend, BY_KEY('WEB-999'))).flush(...problem('TASK_NOT_FOUND', 404));
    await stable(env.harness);
    expect(text(env)).toContain('Nenhuma tarefa deste projeto tem esta chave.');
    expect(env.root().querySelector('h2')?.textContent).toContain('WEB-1');

    type(input, 'APP-3');
    buttonIn(env.root(), 'Adicionar')?.click();
    (await nextRequest(env.backend, BY_KEY('APP-3'))).flush(
      taskDto(3, { key: 'APP-3', projectId: uuid('ae02') }),
    );
    await stable(env.harness);
    expect(text(env)).toContain('Nenhuma tarefa deste projeto tem esta chave.');
    env.backend.expectNone(`${TASK(task)}/dependencies`);
  });

  it('a blocker deleted in the meantime (404 on the POST) reloads and keeps the task open', async () => {
    const task = taskDto(1);
    const env = await open(task);
    type(env.root().querySelector('section[aria-labelledby="blocked-by-title"] input'), 'WEB-5');

    buttonIn(env.root(), 'Adicionar')?.click();
    (await nextRequest(env.backend, BY_KEY('WEB-5'))).flush(taskDto(5));
    (await nextRequest(env.backend, `${TASK(task)}/dependencies`)).flush(
      ...problem('TASK_NOT_FOUND', 404),
    );
    (await nextRequest(env.backend, BY_KEY('WEB-1'))).flush(taskDto(1));
    await stable(env.harness);

    expect(alertText(env)).toContain('Tarefa não encontrada (pode ter sido excluída).');
    expect(env.root().querySelector('h2')?.textContent).toContain('WEB-1');
  });

  it('unsaved edits survive another action that updates the task', async () => {
    const task = taskDto(1);
    const env = await open(task);
    type(env.root().querySelector('input[formcontrolname="title"]'), 'Rascunho não salvo');

    buttonIn(env.root(), 'Mover para Em andamento')?.click();
    (await nextRequest(env.backend, `${TASK(task)}/transition`)).flush(
      taskDto(1, {
        version: 2,
        status: { id: STATUS.doing, name: 'Em andamento', category: 'in_progress' },
      }),
    );
    await stable(env.harness);

    expect(
      env.root().querySelector<HTMLInputElement>('input[formcontrolname="title"]')?.value,
    ).toBe('Rascunho não salvo');
    buttonIn(env.root(), 'Salvar')?.click();
    expect((await nextRequest(env.backend, TASK(task))).request.body).toMatchObject({
      title: 'Rascunho não salvo',
      version: 2,
    });
  });

  it('the "Tarefas" section stays current on the detail', async () => {
    const env = await open(taskDto(1));

    const link = [...env.root().querySelectorAll('nav[aria-label="Seções do projeto"] a')].find(
      (element) => element.textContent?.trim() === 'Tarefas',
    );
    expect(link?.getAttribute('aria-current')).toBe('page');
  });

  it('a cycle is explained', async () => {
    const task = taskDto(1);
    const env = await open(task);
    type(env.root().querySelector('section[aria-labelledby="blocked-by-title"] input'), 'WEB-5');

    buttonIn(env.root(), 'Adicionar')?.click();
    (await nextRequest(env.backend, BY_KEY('WEB-5'))).flush(taskDto(5));
    (await nextRequest(env.backend, `${TASK(task)}/dependencies`)).flush(
      ...problem('DEPENDENCY_CYCLE', 422),
    );
    await stable(env.harness);

    expect(alertText(env)).toContain('Esta dependência criaria um ciclo.');
  });

  it('cancels and reopens with the version', async () => {
    const task = taskDto(1);
    const env = await open(task);

    buttonIn(env.root(), 'Cancelar tarefa')?.click();
    const cancel = await nextRequest(env.backend, `${TASK(task)}/cancel`);
    expect(cancel.request.body).toEqual({ version: 1 });
    cancel.flush(
      taskDto(1, {
        version: 2,
        canceledAt: '2026-10-14T12:00:00.000Z',
        actions: { ...READ_ONLY, reopen: true, delete: true },
      }),
    );
    await stable(env.harness);
    expect(text(env)).toContain('Esta tarefa está cancelada: reabra-a para alterar.');
    expect(env.root().querySelector('form')).toBeNull();

    buttonIn(env.root(), 'Reabrir tarefa')?.click();
    const reopen = await nextRequest(env.backend, `${TASK(task)}/reopen`);
    expect(reopen.request.body).toEqual({ version: 2 });
    reopen.flush(taskDto(1, { version: 3 }));
    await stable(env.harness);
    expect(announced(env)).toContain('Tarefa reaberta.');
  });

  it('deletes after confirmation and goes back to the list announcing it', async () => {
    const task = taskDto(1);
    const env = await open(task);

    buttonIn(env.root(), 'Excluir tarefa')?.click();
    await stable(env.harness);
    expect(text(env)).toContain('Não dá para desfazer.');
    buttonIn(env.root(), 'Confirmar')?.click();
    const request = await nextRequest(env.backend, `${TASK(task)}?version=1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await stable(env.harness);
    (await nextRequest(env.backend, `${PROJECT(tasksProject())}/workflow`)).flush(WORKFLOW);
    (await nextRequest(env.backend, listUrl())).flush({ items: [], nextCursor: null });
    await stable(env.harness);

    expect(TestBed.inject(Router).url).toBe('/o/acme/projects/WEB/tasks');
    expect(announced(env)).toContain('Tarefa WEB-1 excluída.');
  });

  it('a missing or hidden task shows "not found"', async () => {
    const env = await openProjectArea('/tasks/99', tasksProject());

    (await nextRequest(env.backend, BY_KEY('WEB-99'))).flush(...problem('TASK_NOT_FOUND', 404));
    (await nextRequest(env.backend, `${PROJECT(tasksProject())}/workflow`)).flush(WORKFLOW);
    await stable(env.harness);

    expect(alertText(env)).toContain('Tarefa não encontrada ou você não tem acesso a ela.');
  });
});
