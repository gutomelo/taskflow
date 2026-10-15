import { CdkDropList } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import type { Board, Card } from '@taskflow/contracts';
import { acme, nextRequest } from '../../../core/organizations/organizations.testing';
import { buttonIn, openProjectArea, problem, stable } from '../../projects/projects.testing';
import { STATUS, taskSummary, tasksProject, WORKFLOW } from '../tasks.testing';

const BOARD = `/api/v1/organizations/${acme.id}/board?projectId=${tasksProject().id}`;
const MOVE = (card: { id: string }) => `/api/v1/organizations/${acme.id}/tasks/${card.id}/move`;

const card = (number: number, overrides: Partial<Card> = {}): Card => ({
  ...taskSummary(number),
  subtasks: { done: 0, total: 0 },
  ...overrides,
});
const inDoing = {
  status: { id: STATUS.doing, name: 'Em andamento', category: 'in_progress' as const },
};

function board(overrides: Partial<Board> = {}, columns?: Board['columns']): Board {
  return {
    statuses: WORKFLOW.statuses.map(({ inUse: _inUse, ...status }) => status),
    transitions: WORKFLOW.transitions,
    columns: columns ?? [
      {
        statusId: STATUS.todo,
        cards: [card(1, { subtasks: { done: 1, total: 2 } }), card(2)],
        nextCursor: null,
      },
      { statusId: STATUS.doing, cards: [], nextCursor: null },
      { statusId: STATUS.done, cards: [], nextCursor: null },
    ],
    actions: { move: true, configure: true },
    ...overrides,
  };
}

async function open(value: Board = board()) {
  const env = await openProjectArea('/board', tasksProject());
  (await nextRequest(env.backend, BOARD)).flush(value);
  await stable(env.harness);
  return env;
}

type Env = Awaited<ReturnType<typeof open>>;
const columnKeys = (env: Env) =>
  [...env.root().querySelectorAll('ul.cdk-drop-list')].map((list) =>
    [...list.querySelectorAll('[data-card-id] .font-mono')].map((element) =>
      element.textContent?.trim(),
    ),
  );
const announced = (env: Env) => env.root().querySelector('[aria-live="polite"]')?.textContent ?? '';

describe('BoardPage (spec 005, RF-12, CA-09)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('shows one column per status with its cards, subtasks, empty columns and links to the detail', async () => {
    const env = await open();

    const columns = [...env.root().querySelectorAll('section[aria-label]')];
    expect(columns.map((column) => column.querySelector('h3')?.textContent?.trim())).toEqual([
      'A fazer',
      'Em andamento',
      'Concluído',
    ]);
    expect(columns[0]?.getAttribute('aria-label')).toBe('A fazer, 2 cards');
    expect(columnKeys(env)).toEqual([['WEB-1', 'WEB-2'], [], []]);
    expect(columns[0]?.textContent).toContain('Subtarefas 1/2');
    expect(columns[1]?.textContent).toContain('Sem cards');
    expect(env.root().querySelector('[data-card-id] a')?.getAttribute('href')).toBe(
      '/o/acme/projects/WEB/tasks/1',
    );
  });

  it('warns about columns without outgoing transitions', async () => {
    const env = await open(
      board({ transitions: [{ fromStatusId: STATUS.todo, toStatusId: STATUS.doing }] }),
    );

    const warnings = [...env.root().querySelectorAll('section[aria-label]')].map((column) =>
      column.textContent?.includes('Nenhuma transição sai desta coluna.'),
    );
    expect(warnings).toEqual([false, true, true]);
  });

  it('keyboard: "Para baixo" sends the neighbor, announces and returns the focus to the card', async () => {
    const env = await open();
    buttonIn(env.root(), 'Mover WEB-1')?.click();
    await stable(env.harness);

    buttonIn(env.root(), 'Para baixo')?.click();
    const request = await nextRequest(env.backend, MOVE(card(1)));
    expect(request.request.body).toEqual({
      toStatusId: STATUS.todo,
      afterTaskId: card(2).id,
      version: 1,
    });
    await stable(env.harness);
    expect(columnKeys(env)[0]).toEqual(['WEB-2', 'WEB-1']); // otimista
    request.flush({ card: card(1), statusId: STATUS.todo });
    await stable(env.harness);

    expect(announced(env)).toContain('WEB-1 agora é o card 2 da coluna.');
    expect(document.activeElement?.closest('[data-card-id]')?.getAttribute('data-card-id')).toBe(
      card(1).id,
    );
  });

  it('keyboard: moving to another column offers only the allowed ones and puts the card at the end', async () => {
    const env = await open();
    buttonIn(env.root(), 'Mover WEB-2')?.click();
    await stable(env.harness);

    expect(buttonIn(env.root(), 'Para Concluído')).toBeUndefined();
    buttonIn(env.root(), 'Para Em andamento')?.click();
    const request = await nextRequest(env.backend, MOVE(card(2)));
    expect(request.request.body).toEqual({ toStatusId: STATUS.doing, version: 1 });
    request.flush({ card: card(2, { ...inDoing, version: 2 }), statusId: STATUS.doing });
    await stable(env.harness);

    expect(columnKeys(env)).toEqual([['WEB-1'], ['WEB-2'], []]);
    expect(announced(env)).toContain('WEB-2 movida para Em andamento.');
  });

  it('a refused move puts the card back and explains the rule', async () => {
    const env = await open(
      board({}, [
        { statusId: STATUS.todo, cards: [card(1)], nextCursor: null },
        { statusId: STATUS.doing, cards: [card(2, inDoing)], nextCursor: null },
        { statusId: STATUS.done, cards: [], nextCursor: null },
      ]),
    );
    buttonIn(env.root(), 'Mover WEB-2')?.click();
    await stable(env.harness);

    buttonIn(env.root(), 'Para Concluído')?.click();
    const refused = await nextRequest(env.backend, MOVE(card(2)));
    await stable(env.harness);
    expect(columnKeys(env)).toEqual([['WEB-1'], [], ['WEB-2']]);
    const [body, init] = problem('TASK_BLOCKED_BY_DEPENDENCIES', 422);
    refused.flush({ ...body, taskIds: [card(1).id] }, init);
    await stable(env.harness);

    expect(columnKeys(env)).toEqual([['WEB-1'], ['WEB-2'], []]);
    expect(env.root().querySelector('[role="alert"]')?.textContent).toContain(
      'A tarefa está bloqueada por tarefas pendentes: WEB-1.',
    );
  });

  it('a stale card (409) reloads the board after explaining', async () => {
    const env = await open();
    buttonIn(env.root(), 'Mover WEB-1')?.click();
    await stable(env.harness);

    buttonIn(env.root(), 'Para baixo')?.click();
    (await nextRequest(env.backend, MOVE(card(1)))).flush(...problem('VERSION_CONFLICT', 409));
    (await nextRequest(env.backend, BOARD)).flush(
      board({}, [
        { statusId: STATUS.todo, cards: [card(2), card(1, { version: 3 })], nextCursor: null },
        { statusId: STATUS.doing, cards: [], nextCursor: null },
        { statusId: STATUS.done, cards: [], nextCursor: null },
      ]),
    );
    await stable(env.harness);

    expect(env.root().textContent).toContain('A tarefa foi alterada por outra pessoa.');
    expect(columnKeys(env)[0]).toEqual(['WEB-2', 'WEB-1']);
  });

  it('a transition removed elsewhere reloads the board; refreshing clears the message', async () => {
    const env = await open(
      board({}, [
        { statusId: STATUS.todo, cards: [card(1)], nextCursor: null },
        { statusId: STATUS.doing, cards: [card(2, inDoing)], nextCursor: null },
        { statusId: STATUS.done, cards: [], nextCursor: null },
      ]),
    );
    buttonIn(env.root(), 'Mover WEB-2')?.click();
    await stable(env.harness);

    buttonIn(env.root(), 'Para Concluído')?.click();
    (await nextRequest(env.backend, MOVE(card(2)))).flush(
      ...problem('TRANSITION_NOT_ALLOWED', 422),
    );
    (await nextRequest(env.backend, BOARD)).flush(board());
    await stable(env.harness);
    expect(env.root().querySelector('[role="alert"]')).not.toBeNull();

    buttonIn(env.root(), 'Atualizar')?.click();
    (await nextRequest(env.backend, BOARD)).flush(board());
    await stable(env.harness);
    expect(env.root().querySelector('[role="alert"]')).toBeNull();
  });

  it('drag and drop: dropping in another column sends the neighbor; entering a forbidden column is refused', async () => {
    const env = await open(
      board({}, [
        { statusId: STATUS.todo, cards: [card(1)], nextCursor: null },
        { statusId: STATUS.doing, cards: [card(2, inDoing)], nextCursor: null },
        { statusId: STATUS.done, cards: [], nextCursor: null },
      ]),
    );
    const lists = env.harness.fixture.debugElement
      .queryAll(By.directive(CdkDropList))
      .map((element) => element.injector.get(CdkDropList<string>));
    const [todo, doing, done] = lists;
    if (!todo || !doing || !done) throw new Error('drop lists');
    const dragOf = (value: Card) => ({ data: value }) as never;

    expect(done.enterPredicate(dragOf(card(1)), done)).toBe(false);
    expect(doing.enterPredicate(dragOf(card(1)), doing)).toBe(true);
    expect(todo.enterPredicate(dragOf(card(1)), todo)).toBe(true);
    doing.dropped.emit({
      item: dragOf(card(1)),
      container: doing,
      previousContainer: todo,
      currentIndex: 1,
      previousIndex: 0,
    } as never);
    const request = await nextRequest(env.backend, MOVE(card(1)));

    expect(request.request.body).toEqual({
      toStatusId: STATUS.doing,
      afterTaskId: card(2).id,
      version: 1,
    });
  });

  it('CA-09: without the move capability there is no move action and dragging is disabled', async () => {
    const env = await open(board({ actions: { move: false, configure: false } }));

    expect(buttonIn(env.root(), 'Mover WEB-1')).toBeUndefined();
    expect(env.root().querySelector('.cdk-drag-disabled')).not.toBeNull();
  });

  it('loads more cards of a column and refreshes on demand', async () => {
    const env = await open(
      board({}, [
        { statusId: STATUS.todo, cards: [card(1)], nextCursor: 'c2' },
        { statusId: STATUS.doing, cards: [], nextCursor: null },
        { statusId: STATUS.done, cards: [], nextCursor: null },
      ]),
    );

    buttonIn(env.root(), 'Carregar mais')?.click();
    const more = `/api/v1/organizations/${acme.id}/board/columns/${STATUS.todo}?projectId=${tasksProject().id}&cursor=c2`;
    (await nextRequest(env.backend, more)).flush({ cards: [card(2)], nextCursor: null });
    await stable(env.harness);
    expect(columnKeys(env)[0]).toEqual(['WEB-1', 'WEB-2']);

    buttonIn(env.root(), 'Atualizar')?.click();
    (await nextRequest(env.backend, BOARD)).flush(board());
    await stable(env.harness);
    expect(columnKeys(env)[0]).toEqual(['WEB-1', 'WEB-2']);
  });

  it('shows an error with retry', async () => {
    const env = await openProjectArea('/board', tasksProject());
    (await nextRequest(env.backend, BOARD)).flush(...problem('UNEXPECTED', 500));
    await stable(env.harness);

    expect(env.root().textContent).toContain('Não foi possível carregar o quadro.');
    buttonIn(env.root(), 'Tentar de novo')?.click();
    (await nextRequest(env.backend, BOARD)).flush(board());
    await stable(env.harness);
    expect(columnKeys(env)[0]).toEqual(['WEB-1', 'WEB-2']);
  });
});
