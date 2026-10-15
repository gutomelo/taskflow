import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { nextRequest } from '../../core/organizations/organizations.testing';
import { buttonIn, problem, stable } from '../projects/projects.testing';
import {
  BIA,
  listUrl,
  openTasksTab,
  STATUS,
  taskDto,
  tasksProject,
  taskSummary,
  TASKS,
} from './tasks.testing';

type Env = Awaited<ReturnType<typeof openTasksTab>>;

async function choose(env: Env, label: string, value: string) {
  const select = [...env.root().querySelectorAll('label')]
    .find((element) => element.textContent?.trim().startsWith(label))
    ?.querySelector('select');
  if (!select) throw new Error(`no select ${label}`);
  select.value = value;
  select.dispatchEvent(new Event('change'));
  await stable(env.harness);
}

describe('ProjectTasksPage (RF-03, RF-13)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('shows a skeleton, then the tasks as links by number, with status, priority and assignee', async () => {
    const env = await openTasksTab();
    expect(env.root().textContent).toContain('Carregando tarefas…');

    (await nextRequest(env.backend, listUrl())).flush({
      items: [
        taskSummary(2, { priority: 'high', assignee: { userId: BIA, name: 'Bia' } }),
        taskSummary(1, { canceledAt: '2026-10-14T11:00:00.000Z', dueDate: '2026-12-01' }),
      ],
      nextCursor: null,
    });
    await stable(env.harness);

    const links = [
      ...env.root().querySelectorAll<HTMLAnchorElement>('ul[aria-label="Tarefas do projeto"] a'),
    ];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/o/acme/projects/WEB/tasks/2',
      '/o/acme/projects/WEB/tasks/1',
    ]);
    expect(links[0]?.textContent).toContain('WEB-2');
    expect(links[0]?.textContent).toContain('Alta');
    expect(links[0]?.textContent).toContain('Responsável: Bia');
    expect(links[1]?.textContent).toContain('Cancelada');
    expect(links[1]?.textContent).toContain('Sem responsável');
    expect(links[1]?.textContent).toContain('Prazo: 2026-12-01');
    const statusOptions = [...env.root().querySelectorAll('select')][0]?.querySelectorAll('option');
    expect([...(statusOptions ?? [])].map((option) => option.textContent?.trim())).toEqual([
      'Todos os status',
      'A fazer',
      'Em andamento',
      'Concluído',
    ]);
  });

  it('M6.1: each filter goes to the API; "me" travels in assigned, never as a person id', async () => {
    const env = await openTasksTab();
    (await nextRequest(env.backend, listUrl())).flush({
      items: [taskSummary(1)],
      nextCursor: null,
    });
    await stable(env.harness);

    await choose(env, 'Status', STATUS.doing);
    (await nextRequest(env.backend, listUrl(`&statusId=${STATUS.doing}`))).flush({
      items: [],
      nextCursor: null,
    });
    await choose(env, 'Responsável', 'me');
    (await nextRequest(env.backend, listUrl(`&statusId=${STATUS.doing}&assigned=me`))).flush({
      items: [],
      nextCursor: null,
    });
    await choose(env, 'Prioridade', 'urgent');
    const checkbox = env.root().querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox) {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event('change'));
    }
    (
      await nextRequest(
        env.backend,
        listUrl(`&statusId=${STATUS.doing}&assigned=me&priority=urgent`),
      )
    ).flush({
      items: [],
      nextCursor: null,
    });
    (
      await nextRequest(
        env.backend,
        listUrl(`&statusId=${STATUS.doing}&assigned=me&priority=urgent&canceled=true`),
      )
    ).flush({ items: [], nextCursor: null });
    await stable(env.harness);

    expect(env.root().textContent).toContain('Nenhuma tarefa com estes filtros.');
    // O sino da organização (spec 008) consulta o contador por conta própria.
    for (const request of env.backend.match((req) =>
      req.url.endsWith('/notifications/unread-count'),
    )) {
      request.flush({ count: 0, capped: false });
    }
    env.backend.verify();
  });

  it('a stale page of an earlier filter never replaces the current one', async () => {
    const env = await openTasksTab();
    const first = await nextRequest(env.backend, listUrl());
    await choose(env, 'Prioridade', 'high');
    (await nextRequest(env.backend, listUrl('&priority=high'))).flush({
      items: [taskSummary(5, { priority: 'high' })],
      nextCursor: null,
    });
    first.flush({ items: [taskSummary(9)], nextCursor: null });
    await stable(env.harness);

    expect(env.root().textContent).toContain('WEB-5');
    expect(env.root().textContent).not.toContain('WEB-9');
  });

  it('loads more pages one at a time and shows the empty state', async () => {
    const env = await openTasksTab();
    (await nextRequest(env.backend, listUrl())).flush({
      items: [taskSummary(3)],
      nextCursor: 'c2',
    });
    await stable(env.harness);

    const more = buttonIn(env.root(), 'Carregar mais');
    more?.click();
    more?.click();
    const next = env.backend.match(listUrl('&cursor=c2'));
    expect(next).toHaveLength(1);
    next[0]?.flush({ items: [taskSummary(2)], nextCursor: null });
    await stable(env.harness);

    expect(env.root().textContent).toContain('WEB-2');
    expect(buttonIn(env.root(), 'Carregar mais')).toBeUndefined();
  });

  it('shows an error with retry and the empty message', async () => {
    const env = await openTasksTab();
    (await nextRequest(env.backend, listUrl())).flush(...problem('UNEXPECTED', 500));
    await stable(env.harness);
    expect(env.root().querySelector('[role="alert"]')?.textContent).toContain(
      'Não foi possível carregar as tarefas.',
    );

    buttonIn(env.root(), 'Tentar de novo')?.click();
    (await nextRequest(env.backend, listUrl())).flush({ items: [], nextCursor: null });
    await stable(env.harness);

    expect(env.root().textContent).toContain('Nenhuma tarefa neste projeto ainda.');
  });

  it('CA-10: "Nova tarefa" appears only with task:create from the API', async () => {
    const env = await openTasksTab(
      tasksProject({ myRole: 'viewer', capabilities: ['project:read'] }),
    );
    (await nextRequest(env.backend, listUrl())).flush({ items: [], nextCursor: null });
    await stable(env.harness);

    expect(buttonIn(env.root(), 'Nova tarefa')).toBeUndefined();
  });

  it('creates a task: focus on the title, validation, POST without tenant data, announcement and reload', async () => {
    const env = await openTasksTab();
    (await nextRequest(env.backend, listUrl())).flush({ items: [], nextCursor: null });
    await stable(env.harness);

    buttonIn(env.root(), 'Nova tarefa')?.click();
    await stable(env.harness);
    const title = env.root().querySelector<HTMLInputElement>('input[formcontrolname="title"]');
    expect(document.activeElement).toBe(title);
    buttonIn(env.root(), 'Criar tarefa')?.click();
    await stable(env.harness);
    expect(env.root().textContent).toContain('Informe o título.');
    env.backend.expectNone(TASKS);

    if (title) {
      title.value = 'Login com SSO';
      title.dispatchEvent(new Event('input'));
    }
    const formSelect = env.root().querySelector<HTMLSelectElement>('form select');
    if (formSelect) {
      formSelect.value = 'high';
      formSelect.dispatchEvent(new Event('change'));
    }
    buttonIn(env.root(), 'Criar tarefa')?.click();
    const create = await nextRequest(env.backend, TASKS);
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({
      projectId: tasksProject().id,
      title: 'Login com SSO',
      priority: 'high',
    });
    create.flush(taskDto(1, { title: 'Login com SSO', priority: 'high' }));
    (await nextRequest(env.backend, listUrl())).flush({
      items: [taskSummary(1, { title: 'Login com SSO', priority: 'high' })],
      nextCursor: null,
    });
    await stable(env.harness);

    expect(env.root().querySelector('[aria-live="polite"]')?.textContent).toContain(
      'Tarefa WEB-1 criada.',
    );
    expect(env.root().querySelector('form')).toBeNull();
  });

  it('shows API refusals of the creation in a focused alert', async () => {
    const env = await openTasksTab();
    (await nextRequest(env.backend, listUrl())).flush({ items: [], nextCursor: null });
    await stable(env.harness);
    buttonIn(env.root(), 'Nova tarefa')?.click();
    await stable(env.harness);
    const title = env.root().querySelector<HTMLInputElement>('input[formcontrolname="title"]');
    if (title) {
      title.value = 'X';
      title.dispatchEvent(new Event('input'));
    }

    buttonIn(env.root(), 'Criar tarefa')?.click();
    (await nextRequest(env.backend, TASKS)).flush(...problem('TASK_LIMIT_REACHED', 422));
    await stable(env.harness);

    const alert = env.root().querySelector('form [role="alert"]');
    expect(alert?.textContent).toContain('O limite de tarefas foi atingido.');
    expect(document.activeElement).toBe(alert);
  });

  it('a project that disappeared (404) takes the user back to the projects list', async () => {
    const env = await openTasksTab();

    (await nextRequest(env.backend, listUrl())).flush(...problem('PROJECT_NOT_FOUND', 404));
    await stable(env.harness);

    expect(TestBed.inject(Router).url).toBe('/o/acme/projects');
  });
});
