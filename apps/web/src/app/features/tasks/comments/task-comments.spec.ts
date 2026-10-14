import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { CommentDto, CommentPage, ProjectDto, TaskDto } from '@taskflow/contracts';
import { acme, nextRequest } from '../../../core/organizations/organizations.testing';
import {
  buttonIn,
  openProjectArea,
  PROJECT,
  problem,
  stable,
} from '../../projects/projects.testing';
import { taskDto, tasksProject, TASKS, uuid, WORKFLOW } from '../tasks.testing';

const ORG = `/api/v1/organizations/${acme.id}`;
const MIA = uuid('a1a1');
const CAIO = uuid('c1c1');
const TASK = taskDto(1, {
  actions: {
    update: false,
    assign: false,
    cancel: true,
    reopen: false,
    delete: false,
    transitionTo: [],
  },
});
const COMMENTS = `${TASKS}/${TASK.id}/comments`;

type Env = Awaited<ReturnType<typeof openProjectArea>>;

function comment(suffix: string, overrides: Partial<CommentDto> = {}): CommentDto {
  return {
    id: uuid(`c0${suffix}`),
    taskId: TASK.id,
    author: { userId: MIA, name: 'Mia' },
    body: `Comentário ${suffix}`,
    mentions: [],
    createdAt: '2026-10-14T10:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    version: 1,
    actions: { edit: true, delete: true },
    ...overrides,
  };
}

function page(items: CommentDto[], overrides: Partial<CommentPage> = {}): CommentPage {
  return { items, nextCursor: null, count: items.length, actions: { comment: true }, ...overrides };
}

async function open(
  first: CommentPage,
  task: TaskDto = TASK,
  project: ProjectDto = tasksProject(),
): Promise<Env> {
  const env = await openProjectArea(`/tasks/${task.number}`, project);
  (await nextRequest(env.backend, `${TASKS}/by-key/${task.key}`)).flush(task);
  (await nextRequest(env.backend, `${PROJECT(project)}/workflow`)).flush(WORKFLOW);
  await stable(env.harness);
  (await nextRequest(env.backend, COMMENTS)).flush(first);
  await stable(env.harness);
  return env;
}

const section = (env: Env) => env.root().querySelector('section[aria-labelledby="comments-title"]');
const items = (env: Env) =>
  [...(section(env)?.querySelectorAll('li article') ?? [])].map(
    (item) => item.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  );
const type = (element: Element | null | undefined, value: string) => {
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('textarea not found');
  element.value = value;
  element.dispatchEvent(new Event('input'));
};
/** O composer de novo comentário é o último campo da seção. */
const newField = (env: Env) =>
  [...(section(env)?.querySelectorAll('textarea') ?? [])].at(-1) ?? null;
const submitIn = (field: Element | null | undefined) =>
  field?.closest('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
const key = (field: Element | null | undefined, value: string) =>
  field?.dispatchEvent(new KeyboardEvent('keydown', { key: value, cancelable: true }));
const debounce = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('task comments (spec 010, CA-01, CA-04, CA-05, CA-09)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('CA-01: shows the conversation oldest first, with ex-members, edited and removed comments', async () => {
    const env = await open(
      page(
        [
          comment('3', {
            body: null,
            deletedAt: '2026-10-14T11:00:00.000Z',
            actions: { edit: false, delete: false },
          }),
          comment('2', {
            author: { userId: CAIO, name: null },
            editedAt: '2026-10-14T10:30:00.000Z',
          }),
          comment('1', { body: `Oi <@${CAIO}>`, mentions: [{ userId: CAIO, name: null }] }),
        ],
        { count: 2, nextCursor: 'older' },
      ),
    );

    expect(section(env)?.querySelector('h3')?.textContent).toContain('Comentários (2)');
    const texts = items(env);
    expect(texts[0]).toContain('Oi @Ex-membro');
    expect(texts[1]).toContain('Ex-membro');
    expect(texts[1]).toContain('(editado)');
    expect(texts[2]).toContain('Comentário removido');

    buttonIn(section(env), 'Carregar anteriores')?.click();
    (await nextRequest(env.backend, `${COMMENTS}?cursor=older`)).flush(
      page([comment('0')], { count: undefined }),
    );
    await stable(env.harness);
    expect(items(env)[0]).toContain('Comentário 0');
    expect(section(env)?.querySelector('h3')?.textContent).toContain('Comentários (2)');
  });

  it('CA-09: the text is shown exactly, without spaces around mentions and links', async () => {
    const env = await open(
      page([
        comment('1', {
          body: `Oi <@${CAIO}>, veja https://exemplo.com.\nAbraço`,
          mentions: [{ userId: CAIO, name: 'Caio' }],
        }),
      ]),
    );

    const text = section(env)?.querySelector('article p');
    expect(text?.textContent).toBe('Oi @Caio, veja https://exemplo.com/.Abraço');
    expect(text?.querySelectorAll('br')).toHaveLength(1);
  });

  it('CA-09: XSS payloads are shown literally; only http(s) links become links', async () => {
    const env = await open(
      page([
        comment('1', {
          body: '<img src=x onerror=alert(1)> javascript:alert(1) https://exemplo.com',
        }),
      ]),
    );

    expect(section(env)?.querySelector('img')).toBeNull();
    expect(items(env)[0]).toContain('<img src=x onerror=alert(1)>');
    const links = [...(section(env)?.querySelectorAll('a') ?? [])];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['https://exemplo.com/']);
    expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
  });

  it('comments, announcing it, and keeps the draft when refused', async () => {
    const env = await open(page([]));
    expect(section(env)?.textContent).toContain('Nenhum comentário ainda.');

    type(newField(env), `<@${CAIO}>`);
    await stable(env.harness);
    submitIn(newField(env));
    const refused = await nextRequest(env.backend, COMMENTS);
    expect(refused.request.body).toEqual({ body: `<@${CAIO}>` });
    refused.flush(...problem('INVALID_MENTION', 422));
    await stable(env.harness);
    expect(section(env)?.querySelector('[role="alert"]')?.textContent).toContain(
      'acesso ao projeto',
    );
    const draft = newField(env);
    expect(draft instanceof HTMLTextAreaElement && draft.value).toBe(`<@${CAIO}>`);

    type(newField(env), 'Pode revisar?');
    await stable(env.harness);
    submitIn(newField(env));
    (await nextRequest(env.backend, COMMENTS)).flush(comment('1', { body: 'Pode revisar?' }), {
      status: 201,
      statusText: 'Created',
    });
    await stable(env.harness);
    expect(items(env)).toHaveLength(1);
    expect(section(env)?.querySelector('h3')?.textContent).toContain('Comentários (1)');
    expect(env.root().textContent).toContain('Comentário enviado.');
  });

  it('CA-04/CA-05: edits and removes with confirmation; a stale comment reloads the conversation', async () => {
    const env = await open(page([comment('1')]));

    buttonIn(section(env), 'Editar')?.click();
    await stable(env.harness);
    type(section(env)?.querySelector('textarea'), 'Corrigido');
    await stable(env.harness);
    submitIn(section(env)?.querySelector('textarea'));
    const edit = await nextRequest(env.backend, `${ORG}/comments/${comment('1').id}`);
    expect(edit.request.body).toEqual({ body: 'Corrigido', version: 1 });
    edit.flush(
      comment('1', { body: 'Corrigido', version: 2, editedAt: '2026-10-14T10:05:00.000Z' }),
    );
    await stable(env.harness);
    expect(items(env)[0]).toContain('Corrigido');
    // RNF-07: o foco volta ao comentário editado.
    expect(document.activeElement?.id).toBe(`comment-${comment('1').id}`);

    buttonIn(section(env), 'Excluir')?.click();
    await stable(env.harness);
    buttonIn(section(env), 'Excluir comentário')?.click();
    const removal = await nextRequest(env.backend, `${ORG}/comments/${comment('1').id}?version=2`);
    removal.flush(...problem('VERSION_CONFLICT', 409));
    (await nextRequest(env.backend, COMMENTS)).flush(
      page([comment('1', { body: 'De outra pessoa', version: 3 })]),
    );
    await stable(env.harness);
    expect(section(env)?.querySelector('[role="alert"]')?.textContent).toContain(
      'alterado por outra pessoa',
    );
    expect(items(env)[0]).toContain('De outra pessoa');

    buttonIn(section(env), 'Excluir')?.click();
    await stable(env.harness);
    const confirm = buttonIn(section(env), 'Excluir comentário');
    confirm?.focus();
    confirm?.click();
    (await nextRequest(env.backend, `${ORG}/comments/${comment('1').id}?version=3`)).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    (await nextRequest(env.backend, `${ORG}/comments/${comment('1').id}`)).flush(
      comment('1', {
        body: null,
        deletedAt: '2026-10-14T10:10:00.000Z',
        version: 4,
        actions: { edit: false, delete: false },
      }),
    );
    await stable(env.harness);
    expect(items(env)[0]).toContain('Comentário removido');
    // RNF-07: depois de excluir, o foco vai para o composer.
    expect(document.activeElement).toBe(newField(env));
    expect(section(env)?.querySelector('h3')?.textContent).toContain('Comentários (0)');
  });

  it('RF-08/CA-09: mentions by keyboard in a combobox; the body sent carries the token', async () => {
    const env = await open(page([]));
    const field = newField(env);
    expect(field?.getAttribute('role')).toBe('combobox');

    type(field, 'Oi @ca');
    await debounce();
    (await nextRequest(env.backend, `${TASKS}/${TASK.id}/mentionable-users?query=ca`)).flush({
      items: [
        { userId: MIA, name: 'Carla', email: 'carla@exemplo.com' },
        { userId: CAIO, name: 'Caio', email: 'caio@exemplo.com' },
      ],
      nextCursor: null,
    });
    await stable(env.harness);
    const options = [...(section(env)?.querySelectorAll('[role="option"]') ?? [])];
    expect(options.map((option) => option.textContent?.trim().split(' ')[0])).toEqual([
      'Carla',
      'Caio',
    ]);
    expect(field?.getAttribute('aria-expanded')).toBe('true');
    expect(field?.getAttribute('aria-activedescendant')).toBe(options[0]?.id);

    key(field, 'ArrowDown');
    await stable(env.harness);
    expect(field?.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    // As setas dão a volta na lista.
    key(field, 'ArrowDown');
    await stable(env.harness);
    expect(field?.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    key(field, 'ArrowUp');
    await stable(env.harness);
    expect(field?.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    key(field, 'Enter');
    await stable(env.harness);
    expect(field instanceof HTMLTextAreaElement && field.value).toBe('Oi @Caio ');
    expect(field?.getAttribute('aria-expanded')).toBe('false');

    submitIn(field);
    const sent = await nextRequest(env.backend, COMMENTS);
    expect(sent.request.body).toEqual({ body: `Oi <@${CAIO}> ` });
    sent.flush(
      comment('1', { body: `Oi <@${CAIO}>`, mentions: [{ userId: CAIO, name: 'Caio' }] }),
      {
        status: 201,
        statusText: 'Created',
      },
    );
    await stable(env.harness);
    const cleared = newField(env);
    expect(cleared instanceof HTMLTextAreaElement && cleared.value).toBe('');
    expect(items(env)[0]).toContain('Oi @Caio');
  });

  it('Escape closes the suggestions; editing keeps a mention as a name and sends the token back', async () => {
    const env = await open(
      page([comment('1', { body: `Oi <@${CAIO}>`, mentions: [{ userId: CAIO, name: 'Caio' }] })]),
    );
    const field = newField(env);
    type(field, '@ca');
    await debounce();
    (await nextRequest(env.backend, `${TASKS}/${TASK.id}/mentionable-users?query=ca`)).flush({
      items: [{ userId: CAIO, name: 'Caio', email: 'caio@exemplo.com' }],
      nextCursor: null,
    });
    await stable(env.harness);
    key(field, 'Escape');
    await stable(env.harness);
    expect(field?.getAttribute('aria-expanded')).toBe('false');

    // Resposta que chega depois de o campo perder o foco não reabre a lista.
    type(field, '@cai');
    await debounce();
    const late = await nextRequest(env.backend, `${TASKS}/${TASK.id}/mentionable-users?query=cai`);
    field?.dispatchEvent(new Event('blur'));
    late.flush({
      items: [{ userId: CAIO, name: 'Caio', email: 'caio@exemplo.com' }],
      nextCursor: null,
    });
    await stable(env.harness);
    expect(field?.getAttribute('aria-expanded')).toBe('false');

    buttonIn(section(env), 'Editar')?.click();
    await stable(env.harness);
    const editField = section(env)?.querySelector('textarea');
    expect(editField instanceof HTMLTextAreaElement && editField.value).toBe('Oi @Caio');
    type(editField, 'Oi @Caio, pode ver?');
    await stable(env.harness);
    submitIn(editField);
    const edit = await nextRequest(env.backend, `${ORG}/comments/${comment('1').id}`);
    expect(edit.request.body).toEqual({ body: `Oi <@${CAIO}>, pode ver?`, version: 1 });
  });

  it('decision 9: a canceled task has no composer nor edit, but keeps delete', async () => {
    const canceled = { ...TASK, canceledAt: '2026-10-14T09:00:00.000Z' };
    const env = await open(
      page([comment('1', { actions: { edit: false, delete: true } })], {
        actions: { comment: false },
      }),
      canceled,
    );

    expect(section(env)?.querySelector('textarea')).toBeNull();
    expect(section(env)?.textContent).toContain('A tarefa está cancelada: reabra-a para comentar.');
    expect(buttonIn(section(env), 'Editar')).toBeUndefined();
    expect(buttonIn(section(env), 'Excluir')).toBeDefined();
  });

  it('shows an error with retry', async () => {
    const env = await openProjectArea(`/tasks/${TASK.number}`, tasksProject());
    (await nextRequest(env.backend, `${TASKS}/by-key/${TASK.key}`)).flush(TASK);
    (await nextRequest(env.backend, `${PROJECT(tasksProject())}/workflow`)).flush(WORKFLOW);
    await stable(env.harness);
    (await nextRequest(env.backend, COMMENTS)).flush(...problem('UNEXPECTED', 500));
    await stable(env.harness);
    expect(section(env)?.textContent).toContain('Não foi possível carregar os comentários.');

    buttonIn(section(env), 'Tentar de novo')?.click();
    (await nextRequest(env.backend, COMMENTS)).flush(page([comment('1')]));
    await stable(env.harness);
    expect(items(env)).toHaveLength(1);
  });
});
