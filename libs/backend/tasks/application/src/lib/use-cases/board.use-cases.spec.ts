import { RateLimitedError } from '@taskflow/backend/shared/application';
import { TASK_REBALANCE_POLICY } from '../shared/task-limits';
import type { TasksTestbed } from '../../testing/tasks-fakes';
import { as, createTasksWorld, forceCancel, forceStatus, WEB } from '../../testing/tasks-world';
import {
  BOARD_COLUMN_CONCURRENCY,
  CountTasksByStatusUseCase,
  GetBoardUseCase,
  ListColumnCardsUseCase,
  MoveCardUseCase,
  ReassignTasksStatusUseCase,
} from './board.use-cases';
import { CreateTaskUseCase } from './create-task.use-case';
import { ReopenTaskUseCase, TransitionTaskUseCase } from './task-lifecycle.use-cases';

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: { code?: string; name?: string }) => error.code ?? error.name,
  );

async function create(
  bed: TasksTestbed,
  input: Partial<Parameters<CreateTaskUseCase['execute']>[1]> = {},
  actor = 'mia',
) {
  return new CreateTaskUseCase(bed).execute(as(actor), { projectId: WEB, title: 'T', ...input });
}

/** Chaves das colunas no quadro (só ids na ordem). */
async function columns(bed: TasksTestbed, actor = 'mia') {
  const board = await new GetBoardUseCase(bed).execute(as(actor), { projectId: WEB });
  return Object.fromEntries(
    board.columns.map((column) => [column.statusId, column.cards.map((card) => card.key)]),
  );
}

const versionOf = (bed: TasksTestbed, taskId: string) =>
  bed.tasks.rows.find((row) => row.id === taskId)?.version ?? 0;

function move(
  bed: TasksTestbed,
  taskId: string,
  target: Partial<Parameters<MoveCardUseCase['execute']>[1]> = {},
  actor = 'bia',
) {
  return new MoveCardUseCase(bed).execute(as(actor), {
    taskId,
    toStatusId: 'web-todo',
    version: versionOf(bed, taskId),
    ...target,
  });
}

describe('GetBoard / ListColumnCards (RF-01, RF-04)', () => {
  it('queries at most a few columns at a time (connection pool)', async () => {
    const { bed, web } = createTasksWorld();
    web.workflow = {
      statuses: Array.from({ length: 12 }, (_, position) => ({
        id: `web-s${position}`,
        name: `S${position}`,
        category: position === 0 ? 'todo' : 'in_progress',
        position,
      })),
      transitions: [],
    };
    const columnPage = bed.tasks.columnPage.bind(bed.tasks);
    let inFlight = 0;
    let peak = 0;
    bed.tasks.columnPage = async (...args) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return columnPage(...args);
    };

    const board = await new GetBoardUseCase(bed).execute(as('bia'), { projectId: WEB });

    expect(board.columns).toHaveLength(12);
    expect(peak).toBe(BOARD_COLUMN_CONCURRENCY);
  });

  it('one column per status in workflow order, only top-level not canceled cards, in rank order', async () => {
    const { bed } = createTasksWorld();
    const first = await create(bed);
    const second = await create(bed, { assigneeUserId: 'bia' });
    await create(bed, { parentTaskId: first.id, isRequired: true });
    const done = await create(bed, { parentTaskId: first.id });
    forceStatus(bed, done.id, 'web-done');
    const canceled = await create(bed);
    forceCancel(bed, canceled.id);
    bed.users.calls.length = 0;
    bed.tasks.subtaskCountCalls = 0;

    const board = await new GetBoardUseCase(bed).execute(as('bia'), { projectId: WEB });

    expect(board.statuses.map((status) => status.id)).toEqual([
      'web-todo',
      'web-doing',
      'web-done',
    ]);
    expect(board.transitions).toHaveLength(4);
    expect(board.columns.map((column) => column.cards.map((card) => card.key))).toEqual([
      ['WEB-1', 'WEB-2'],
      [],
      [],
    ]);
    expect(board.columns[0]?.cards[0]?.subtasks).toEqual({ done: 1, total: 2 });
    expect(board.columns[0]?.cards[1]).toMatchObject({
      id: second.id,
      assignee: { userId: 'bia', name: 'BIA' },
    });
    expect(bed.users.calls).toHaveLength(1);
    expect(bed.tasks.subtaskCountCalls).toBe(1);
  });

  it('actions come from the effective role and the archive; hidden project is 404', async () => {
    const { bed, web } = createTasksWorld();
    const actions = async (actor: string) =>
      (await new GetBoardUseCase(bed).execute(as(actor), { projectId: WEB })).actions;

    expect(await actions('mia')).toEqual({ move: true, configure: true });
    expect(await actions('bia')).toEqual({ move: true, configure: false });
    expect(await actions('vivi')).toEqual({ move: false, configure: false });
    web.archived = true;
    expect(await actions('mia')).toEqual({ move: false, configure: false });
    expect(await code(new GetBoardUseCase(bed).execute(as('otto'), { projectId: WEB }))).toBe(
      'PROJECT_NOT_FOUND',
    );
  });

  it('pages a column by cursor; the cursor is bound to its column and validated', async () => {
    const { bed } = createTasksWorld();
    for (let index = 0; index < 5; index += 1) await create(bed);
    const board = await new GetBoardUseCase(bed).execute(as('mia'), { projectId: WEB, limit: 2 });
    const cursor = board.columns[0]?.nextCursor ?? null;
    const list = new ListColumnCardsUseCase(bed);

    const next = await list.execute(as('mia'), {
      projectId: WEB,
      statusId: 'web-todo',
      cursor,
      limit: 2,
    });
    const last = await list.execute(as('mia'), {
      projectId: WEB,
      statusId: 'web-todo',
      cursor: next.nextCursor,
    });

    expect(board.columns[0]?.cards.map((card) => card.key)).toEqual(['WEB-1', 'WEB-2']);
    expect(next.cards.map((card) => card.key)).toEqual(['WEB-3', 'WEB-4']);
    expect(last.cards.map((card) => card.key)).toEqual(['WEB-5']);
    expect(last.nextCursor).toBeNull();
    expect(
      await code(list.execute(as('mia'), { projectId: WEB, statusId: 'web-doing', cursor })),
    ).toBe('INVALID_CURSOR');
    expect(
      await code(list.execute(as('mia'), { projectId: WEB, statusId: 'web-todo', cursor: 'x' })),
    ).toBe('INVALID_CURSOR');
    expect(await code(list.execute(as('mia'), { projectId: WEB, statusId: 'app-todo' }))).toBe(
      'STATUS_NOT_FOUND',
    );
    expect(await code(list.execute(as('otto'), { projectId: WEB, statusId: 'web-todo' }))).toBe(
      'PROJECT_NOT_FOUND',
    );
  });
});

describe('MoveCard (RF-02, RF-03, BR-009)', () => {
  async function three() {
    const world = createTasksWorld();
    const [a, b, c] = [await create(world.bed), await create(world.bed), await create(world.bed)];
    return { ...world, a, b, c };
  }

  it('reorders within the column: only the moved card changes, without a version bump', async () => {
    const { bed, a, b, c } = await three();
    bed.events.events = [];

    await move(bed, c.id, { afterTaskId: a.id });
    expect((await columns(bed))['web-todo']).toEqual(['WEB-1', 'WEB-3', 'WEB-2']);
    await move(bed, a.id, { beforeTaskId: b.id });
    expect((await columns(bed))['web-todo']).toEqual(['WEB-3', 'WEB-1', 'WEB-2']);
    await move(bed, c.id);
    expect((await columns(bed))['web-todo']).toEqual(['WEB-1', 'WEB-2', 'WEB-3']);

    expect(bed.tasks.placements.slice(-3).map((placement) => placement.taskId)).toEqual([
      c.id,
      a.id,
      c.id,
    ]);
    expect([versionOf(bed, a.id), versionOf(bed, c.id)]).toEqual([1, 1]);
    expect(bed.events.events.map((event) => event.type)).toEqual([
      'tasks.card_moved',
      'tasks.card_moved',
      'tasks.card_moved',
    ]);
    expect(bed.tasks.projectLocks.slice(-3)).toEqual([WEB, WEB, WEB]);
  });

  it('BR-004: another column is a status change by the workflow; refused moves change nothing', async () => {
    const { bed, a, b } = await three();
    const before = new Map(bed.tasks.ranks);

    expect(await code(move(bed, a.id, { toStatusId: 'web-done' }))).toBe('TRANSITION_NOT_ALLOWED');
    expect(bed.tasks.ranks).toEqual(before);
    const moved = await move(bed, a.id, { toStatusId: 'web-doing' });

    expect(moved).toMatchObject({ statusId: 'web-doing', card: { key: 'WEB-1', version: 2 } });
    expect(await columns(bed)).toEqual({
      'web-todo': ['WEB-2', 'WEB-3'],
      'web-doing': ['WEB-1'],
      'web-done': [],
    });
    await move(bed, b.id, { toStatusId: 'web-doing', beforeTaskId: a.id });
    expect((await columns(bed))['web-doing']).toEqual(['WEB-2', 'WEB-1']);
  });

  it('BR-001/BR-006: entering done keeps status and position when refused', async () => {
    const { bed, a, b } = await three();
    const required = await create(bed, { parentTaskId: a.id, isRequired: true });
    await move(bed, a.id, { toStatusId: 'web-doing' });
    await move(bed, b.id, { toStatusId: 'web-doing' });
    const before = new Map(bed.tasks.ranks);

    const refused = move(bed, a.id, { toStatusId: 'web-done' });
    await expect(refused).rejects.toMatchObject({
      code: 'TASK_HAS_PENDING_REQUIRED_SUBTASKS',
      taskIds: [required.id],
    });
    expect(bed.tasks.ranks).toEqual(before);
    expect(bed.tasks.rows.find((row) => row.id === a.id)?.statusId).toBe('web-doing');
  });

  it('decides 404 → 403 → archived → canceled → version → not a card → status → position → rules', async () => {
    const { bed, web, a, b } = await three();
    const sub = await create(bed, { parentTaskId: a.id });
    const elsewhere = await create(bed, { projectId: 'p-app' }, 'bia');

    expect(await code(move(bed, a.id, {}, 'otto'))).toBe('TASK_NOT_FOUND');
    expect(await code(move(bed, a.id, { version: 99 }, 'vivi'))).toBe('INSUFFICIENT_ROLE');
    expect(await code(move(bed, a.id, { version: 99 }))).toBe('VERSION_CONFLICT');
    expect(await code(move(bed, sub.id, { toStatusId: 'nope' }))).toBe('TASK_NOT_A_CARD');
    expect(await code(move(bed, a.id, { toStatusId: 'app-todo' }))).toBe('STATUS_NOT_FOUND');
    for (const afterTaskId of [sub.id, elsewhere.id, a.id, 'missing']) {
      expect(await code(move(bed, a.id, { afterTaskId })), afterTaskId).toBe('INVALID_POSITION');
    }
    // Vizinho de outra coluna, mesmo numa transição proibida: a posição vem antes da regra.
    expect(await code(move(bed, a.id, { toStatusId: 'web-done', afterTaskId: b.id }))).toBe(
      'INVALID_POSITION',
    );
    forceCancel(bed, b.id);
    expect(await code(move(bed, b.id, { version: 99 }))).toBe('TASK_CANCELED');
    web.archived = true;
    expect(await code(move(bed, a.id, { version: 99 }, 'vivi'))).toBe('INSUFFICIENT_ROLE');
    expect(await code(move(bed, a.id, { version: 99 }))).toBe('PROJECT_ARCHIVED');
  });

  it('B2: tied ranks are rebalanced before computing a key between them', async () => {
    const { bed, a, b, c } = await three();
    bed.tasks.ranks.set(a.id, 'a5');
    bed.tasks.ranks.set(b.id, 'a5');
    const [first, second] = [a.id, b.id].sort();

    await move(bed, c.id, { afterTaskId: first ?? '' });

    expect(bed.tasks.rebalances).toEqual(['web-todo']);
    const order = (
      await new GetBoardUseCase(bed).execute(as('mia'), { projectId: WEB })
    ).columns[0]?.cards.map((card) => card.id);
    expect(order).toEqual([first, c.id, second]);
  });

  it('M1: a refused move neither rebalances nor spends the project quota', async () => {
    const { bed, a, b, c } = await three();
    for (const task of [a, b]) {
      await move(bed, task.id, { toStatusId: 'web-doing' });
      await move(bed, task.id, { toStatusId: 'web-done' });
    }
    bed.tasks.ranks.set(a.id, 'a5');
    bed.tasks.ranks.set(b.id, 'a5');

    expect(await code(move(bed, c.id, { toStatusId: 'web-done', afterTaskId: a.id }))).toBe(
      'TRANSITION_NOT_ALLOWED',
    );
    expect(bed.tasks.rebalances).toEqual([]);
    expect(bed.rateLimiter.consumed.get(`${TASK_REBALANCE_POLICY.name}|${WEB}`) ?? 0).toBe(0);
  });

  it('long keys trigger a rebalance, limited per project (M1)', async () => {
    const { bed, a, b, c } = await three();
    bed.tasks.ranks.set(a.id, `a1${'V'.repeat(30)}`);
    bed.tasks.ranks.set(b.id, `a1${'V'.repeat(30)}W`);

    await move(bed, c.id, { afterTaskId: a.id });
    expect(bed.tasks.rebalances).toHaveLength(1);
    expect((await columns(bed))['web-todo']).toEqual(['WEB-1', 'WEB-3', 'WEB-2']);
    expect([...bed.tasks.ranks.values()].every((rank) => rank.length <= 32)).toBe(true);

    bed.tasks.ranks.set(a.id, `a1${'V'.repeat(30)}`);
    bed.tasks.ranks.set(c.id, `a1${'V'.repeat(30)}W`);
    bed.rateLimiter.consumed.set(
      `${TASK_REBALANCE_POLICY.name}|${WEB}`,
      TASK_REBALANCE_POLICY.points,
    );
    const before = new Map(bed.tasks.ranks);
    await expect(move(bed, b.id, { afterTaskId: a.id })).rejects.toBeInstanceOf(RateLimitedError);
    expect(bed.tasks.ranks).toEqual(before);
  });
});

describe('RF-11, D6: cards that change outside the board go to the end of the column', () => {
  it('creation, transition from the detail and reopening', async () => {
    const { bed } = createTasksWorld();
    const [a, b] = [await create(bed), await create(bed)];
    await move(bed, b.id, { beforeTaskId: a.id });
    const c = await create(bed);
    expect((await columns(bed))['web-todo']).toEqual(['WEB-2', 'WEB-1', 'WEB-3']);

    const transition = new TransitionTaskUseCase(bed);
    // WEB-3 entra antes em "Em andamento"; WEB-1 (chave menor) entra depois e vai para o fim.
    await transition.execute(as('mia'), {
      taskId: c.id,
      statusId: 'web-doing',
      version: versionOf(bed, c.id),
    });
    await transition.execute(as('mia'), {
      taskId: a.id,
      statusId: 'web-doing',
      version: versionOf(bed, a.id),
    });
    expect((await columns(bed))['web-doing']).toEqual(['WEB-3', 'WEB-1']);
    await transition.execute(as('mia'), {
      taskId: a.id,
      statusId: 'web-todo',
      version: versionOf(bed, a.id),
    });
    expect(await columns(bed)).toMatchObject({
      'web-todo': ['WEB-2', 'WEB-1'],
      'web-doing': ['WEB-3'],
    });

    forceCancel(bed, b.id);
    await new ReopenTaskUseCase(bed).execute(as('mia'), {
      taskId: b.id,
      version: versionOf(bed, b.id),
    });
    expect((await columns(bed))['web-todo']).toEqual(['WEB-1', 'WEB-2']);
  });
});

describe('WorkflowStatusUsage use cases (for projects)', () => {
  it('counts every task by status and reassigns them all', async () => {
    const { bed } = createTasksWorld();
    const a = await create(bed);
    await create(bed, { parentTaskId: a.id });
    const canceled = await create(bed);
    forceCancel(bed, canceled.id);
    await move(bed, a.id, { toStatusId: 'web-doing' });

    expect(await new CountTasksByStatusUseCase(bed).execute('org-a', WEB)).toEqual(
      new Map([
        ['web-doing', 1],
        ['web-todo', 2],
      ]),
    );
    expect(
      await new ReassignTasksStatusUseCase(bed).execute('org-a', WEB, 'web-todo', 'web-doing'),
    ).toBe(2);
    expect(await new CountTasksByStatusUseCase(bed).execute('org-a', WEB)).toEqual(
      new Map([['web-doing', 3]]),
    );
  });
});
