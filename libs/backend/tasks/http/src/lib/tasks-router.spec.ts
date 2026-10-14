import express, { type RequestHandler } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request, { type Response } from 'supertest';
import {
  createCsrfProtection,
  createErrorHandler,
  createTenantScope,
  HttpError,
  notFoundHandler,
} from '@taskflow/backend/shared/http';
import type { OrganizationRole } from '@taskflow/backend/shared/kernel';
import {
  AddDependencyUseCase,
  AssignTaskUseCase,
  CancelTaskUseCase,
  CreateTaskUseCase,
  DeleteTaskUseCase,
  GetBoardUseCase,
  GetTaskUseCase,
  ListColumnCardsUseCase,
  MoveCardUseCase,
  ListAssignableUsersUseCase,
  ListTasksUseCase,
  RemoveDependencyUseCase,
  ReopenTaskUseCase,
  TASK_WRITE_POLICY,
  TransitionTaskUseCase,
  UpdateTaskUseCase,
} from '@taskflow/backend/tasks/application';
import { createTasksTestbed, type TasksTestbed } from '@taskflow/backend/tasks/application/testing';
import {
  assignableUserPageSchema,
  boardSchema,
  columnPageSchema,
  moveCardResponseSchema,
  problemDetailsSchema,
  taskPageSchema,
  taskSchema,
} from '@taskflow/contracts';
import { tasksErrorMappings } from './tasks-error-mappings';
import { createTasksRouter } from './tasks-router';

const APP_ORIGIN = 'http://localhost:4200';
const uuid = (suffix: string) => `0192a000-0000-7000-8000-${suffix.padStart(12, '0')}`;
const ORG = uuid('f0f0');
const WEB = uuid('ae00');
const HIDDEN = uuid('ae01');
const [TODO, DOING, DONE] = [uuid('5101'), uuid('5102'), uuid('5103')];
const ANA = uuid('a0a0'); // owner
const MIA = uuid('a1a1'); // member, manager em WEB
const BIA = uuid('b1b1'); // member, member em WEB
const VIVI = uuid('d1d1'); // viewer, viewer em WEB
const CAIO = uuid('c1c1'); // member sem participação
const MISSING = uuid('0999');
const BASE = `/api/v1/organizations/${ORG}`;

function world(): TasksTestbed {
  const bed = createTasksTestbed();
  const access = bed.projectAccess;
  const web = access.addProject({
    organizationId: ORG,
    projectId: WEB,
    key: 'WEB',
    workflow: {
      statuses: [
        { id: TODO, name: 'A fazer', category: 'todo', position: 0 },
        { id: DOING, name: 'Em andamento', category: 'in_progress', position: 1 },
        { id: DONE, name: 'Concluído', category: 'done', position: 2 },
      ],
      transitions: [
        { fromStatusId: TODO, toStatusId: DOING },
        { fromStatusId: DOING, toStatusId: TODO },
        { fromStatusId: DOING, toStatusId: DONE },
        { fromStatusId: DONE, toStatusId: DOING },
      ],
    },
  });
  access.addProject({ organizationId: ORG, projectId: HIDDEN, key: 'HID' });
  const people: Array<[string, OrganizationRole]> = [
    [ANA, 'owner'],
    [MIA, 'member'],
    [BIA, 'member'],
    [VIVI, 'viewer'],
    [CAIO, 'member'],
  ];
  for (const [userId, role] of people) access.setMember(ORG, userId, role);
  web.participations.set(MIA, 'manager');
  web.participations.set(BIA, 'member');
  web.participations.set(VIVI, 'viewer');
  return bed;
}

function buildApp(bed: TasksTestbed) {
  const csrf = createCsrfProtection({
    appOrigin: APP_ORIGIN,
    secret: 's'.repeat(43),
    secureCookie: true,
  });
  const authenticate: RequestHandler = (req, _res, next) => {
    const userId = req.get('x-test-user');
    if (!userId) {
      next(new HttpError(401, 'UNAUTHENTICATED', 'Sessão necessária'));
      return;
    }
    req.actor = { userId, sessionId: `s-${userId}` };
    next();
  };
  const router = createTasksRouter({
    useCases: {
      createTask: new CreateTaskUseCase(bed),
      listTasks: new ListTasksUseCase(bed),
      getTask: new GetTaskUseCase(bed),
      listAssignableUsers: new ListAssignableUsersUseCase(bed),
      updateTask: new UpdateTaskUseCase(bed),
      assignTask: new AssignTaskUseCase(bed),
      transitionTask: new TransitionTaskUseCase(bed),
      cancelTask: new CancelTaskUseCase(bed),
      reopenTask: new ReopenTaskUseCase(bed),
      deleteTask: new DeleteTaskUseCase(bed),
      addDependency: new AddDependencyUseCase(bed),
      removeDependency: new RemoveDependencyUseCase(bed),
      getBoard: new GetBoardUseCase(bed),
      listColumnCards: new ListColumnCardsUseCase(bed),
      moveCard: new MoveCardUseCase(bed),
    },
  });
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.use(express.json());
  app.get('/test/csrf', authenticate, (req, res) => {
    csrf.issue(res, req.actor?.sessionId);
    res.status(204).end();
  });
  app.use(
    '/api/v1',
    createTenantScope({
      authenticate,
      csrf,
      resolve: async ({ userId, organizationId }) => {
        const role = bed.projectAccess.organizationRoles.get(`${organizationId}|${userId}`);
        return role ? { organizationRole: role } : null;
      },
      routers: [router],
    }),
  );
  app.use(notFoundHandler);
  app.use(createErrorHandler({ domainErrors: tasksErrorMappings }));
  return app;
}

function clientFor(app: express.Express, userId: string) {
  let csrfToken: string | null = null;
  const token = async (): Promise<string> => {
    if (csrfToken) return csrfToken;
    const response = await request(app).get('/test/csrf').set('x-test-user', userId);
    const raw = response.headers['set-cookie'];
    const cookie = (Array.isArray(raw) ? raw : [raw]).find((value) =>
      value?.startsWith('__Host-tf_csrf='),
    );
    const issued = cookie?.split(';')[0]?.slice('__Host-tf_csrf='.length) ?? '';
    csrfToken = issued;
    return issued;
  };
  const mutate = async (
    method: 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: object,
  ) => {
    const value = await token();
    const call = request(app)
      [method](`${BASE}${path}`)
      .set('x-test-user', userId)
      .set('Cookie', [`__Host-tf_csrf=${value}`])
      .set('Origin', APP_ORIGIN)
      .set('X-CSRF-Token', value);
    return body === undefined ? call : call.send(body);
  };
  return {
    get: (path: string) => request(app).get(`${BASE}${path}`).set('x-test-user', userId),
    post: (path: string, body?: object) => mutate('post', path, body ?? {}),
    patch: (path: string, body: object) => mutate('patch', path, body),
    put: (path: string, body: object) => mutate('put', path, body),
    delete: (path: string) => mutate('delete', path),
  };
}

const problem = (response: Response) => problemDetailsSchema.parse(response.body);

/** Espera a resposta e confere o status (com o corpo na mensagem de falha). */
async function at(pending: PromiseLike<Response>, status: number): Promise<Response> {
  const response = await pending;
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
}

describe('tasks router (spec 004, T9)', () => {
  let bed: TasksTestbed;
  let app: express.Express;
  let mia: ReturnType<typeof clientFor>;

  beforeEach(() => {
    bed = world();
    app = buildApp(bed);
    mia = clientFor(app, MIA);
  });

  async function created(body: object = { projectId: WEB, title: 'Tarefa' }, client = mia) {
    const response = await client.post('/tasks', body);
    expect(response.status).toBe(201);
    return taskSchema.parse(response.body);
  }

  it('creates (201 + Location), reads by id and by key, and lists — all matching the contracts', async () => {
    const response = await mia.post('/tasks', {
      projectId: WEB,
      title: 'Login',
      priority: 'high',
      dueDate: '2026-12-01',
    });
    const task = taskSchema.parse(response.body);

    expect(response.status).toBe(201);
    expect(response.headers['location']).toBe(`${BASE}/tasks/${task.id}`);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(task).toMatchObject({
      key: 'WEB-1',
      priority: 'high',
      dueDate: '2026-12-01',
      status: { id: TODO },
    });
    expect(taskSchema.parse((await at(mia.get(`/tasks/${task.id}`), 200)).body)).toEqual(task);
    expect(taskSchema.parse((await at(mia.get('/tasks/by-key/WEB-1'), 200)).body)).toEqual(task);
    const page = taskPageSchema.parse(
      (await at(mia.get(`/tasks?projectId=${WEB}&priority=high`), 200)).body,
    );
    expect(page.items.map((item) => item.key)).toEqual(['WEB-1']);
  });

  it('400: unknown body fields, malformed queries and domain validation', async () => {
    expect(
      problem(
        await at(mia.post('/tasks', { projectId: WEB, title: 'X', organizationId: ORG }), 400),
      ).code,
    ).toBe('VALIDATION_FAILED');
    expect(problem(await at(mia.post('/tasks', { projectId: WEB, title: '   ' }), 400)).code).toBe(
      'INVALID_TASK_TITLE',
    );
    expect(
      problem(
        await at(mia.post('/tasks', { projectId: WEB, title: 'X', dueDate: '2026-02-30' }), 400),
      ).code,
    ).toBe('INVALID_DUE_DATE');
    expect(problem(await at(mia.get('/tasks'), 400)).code).toBe('VALIDATION_FAILED');
    expect(problem(await at(mia.get(`/tasks?projectId=${WEB}&assigneeUserId=me`), 400)).code).toBe(
      'VALIDATION_FAILED',
    );
    const task = await created();
    expect(problem(await at(mia.patch(`/tasks/${task.id}`, { version: 1 }), 400)).code).toBe(
      'VALIDATION_FAILED',
    );
    expect(problem(await at(mia.delete(`/tasks/${task.id}`), 400)).code).toBe('VALIDATION_FAILED');
  });

  it('403 for a viewer, 404 for a hidden project or task, malformed ids and keys', async () => {
    const vivi = clientFor(app, VIVI);
    const caio = clientFor(app, CAIO);
    const task = await created();

    expect(problem(await at(vivi.post('/tasks', { projectId: WEB, title: 'X' }), 403)).code).toBe(
      'INSUFFICIENT_ROLE',
    );
    expect(problem(await at(mia.post('/tasks', { projectId: HIDDEN, title: 'X' }), 404)).code).toBe(
      'PROJECT_NOT_FOUND',
    );
    expect(problem(await at(caio.get(`/tasks?projectId=${WEB}`), 404)).code).toBe(
      'PROJECT_NOT_FOUND',
    );
    const hidden = await at(caio.get(`/tasks/${task.id}`), 404);
    const missing = await at(mia.get(`/tasks/${MISSING}`), 404);
    expect(problem(hidden)).toMatchObject({
      code: 'TASK_NOT_FOUND',
      title: problem(missing).title,
    });
    expect(problem(await at(mia.get('/tasks/not-a-uuid'), 404)).code).toBe('TASK_NOT_FOUND');
    expect(problem(await at(mia.get('/tasks/by-key/web-1'), 404)).code).toBe('TASK_NOT_FOUND');
    expect(
      problem(await at(caio.patch(`/tasks/${task.id}`, { title: 'Y', version: 1 }), 404)).code,
    ).toBe('TASK_NOT_FOUND');
  });

  it('a malformed id never reaches the use case (no 500 from the database, no limit consumed)', async () => {
    expect(
      problem(await at(mia.patch('/tasks/not-a-uuid', { title: 'Y', version: 1 }), 404)).code,
    ).toBe('TASK_NOT_FOUND');
    expect(
      problem(await at(mia.delete(`/tasks/${MISSING}/dependencies/not-a-uuid`), 404)).code,
    ).toBe('TASK_NOT_FOUND');
    expect(bed.rateLimiter.keys()).toEqual([]);
  });

  it('409: version, canceled task and archived project', async () => {
    const task = await created();

    expect(
      problem(await at(mia.patch(`/tasks/${task.id}`, { title: 'Y', version: 9 }), 409)).code,
    ).toBe('VERSION_CONFLICT');
    const canceled = taskSchema.parse(
      (await at(mia.post(`/tasks/${task.id}/cancel`, { version: 1 }), 200)).body,
    );
    expect(canceled.canceledAt).not.toBeNull();
    expect(
      problem(await at(mia.patch(`/tasks/${task.id}`, { title: 'Y', version: 2 }), 409)).code,
    ).toBe('TASK_CANCELED');
    expect(
      taskSchema.parse((await at(mia.post(`/tasks/${task.id}/reopen`, { version: 2 }), 200)).body)
        .canceledAt,
    ).toBeNull();
    bed.projectAccess.projectById(WEB).archived = true;
    expect(
      problem(await at(mia.patch(`/tasks/${task.id}`, { title: 'Y', version: 3 }), 409)).code,
    ).toBe('PROJECT_ARCHIVED');
  });

  it('422 with the taskIds extension for BR-001 and BR-006; TRANSITION_NOT_ALLOWED', async () => {
    const parent = await created({ projectId: WEB, title: 'Pai' });
    const child = await created({
      projectId: WEB,
      title: 'Filha',
      parentTaskId: parent.id,
      isRequired: true,
    });
    const blocker = await created({ projectId: WEB, title: 'Bloqueadora' });

    expect(
      problem(
        await at(mia.post(`/tasks/${parent.id}/transition`, { statusId: DONE, version: 1 }), 422),
      ).code,
    ).toBe('TRANSITION_NOT_ALLOWED');
    await at(mia.post(`/tasks/${parent.id}/transition`, { statusId: DOING, version: 1 }), 200);
    const pending = problem(
      await at(mia.post(`/tasks/${parent.id}/transition`, { statusId: DONE, version: 2 }), 422),
    );
    expect(pending).toMatchObject({
      code: 'TASK_HAS_PENDING_REQUIRED_SUBTASKS',
      taskIds: [child.id],
    });
    await at(mia.post(`/tasks/${child.id}/dependencies`, { blockingTaskId: blocker.id }), 201);
    await at(mia.post(`/tasks/${child.id}/transition`, { statusId: DOING, version: 1 }), 200);
    const blocked = problem(
      await at(mia.post(`/tasks/${child.id}/transition`, { statusId: DONE, version: 2 }), 422),
    );
    expect(blocked).toMatchObject({ code: 'TASK_BLOCKED_BY_DEPENDENCIES', taskIds: [blocker.id] });
  });

  it('dependencies: 201 then 200 (idempotent), 204 to remove, 404 DEPENDENCY_NOT_FOUND after', async () => {
    const a = await created({ projectId: WEB, title: 'A' });
    const b = await created({ projectId: WEB, title: 'B' });

    const first = await at(mia.post(`/tasks/${a.id}/dependencies`, { blockingTaskId: b.id }), 201);
    await at(mia.post(`/tasks/${a.id}/dependencies`, { blockingTaskId: b.id }), 200);
    expect(taskSchema.parse(first.body).blockedBy.map((item) => item.id)).toEqual([b.id]);
    expect(
      problem(await at(mia.post(`/tasks/${b.id}/dependencies`, { blockingTaskId: a.id }), 422))
        .code,
    ).toBe('DEPENDENCY_CYCLE');
    await at(mia.delete(`/tasks/${a.id}/dependencies/${b.id}`), 204);
    expect(problem(await at(mia.delete(`/tasks/${a.id}/dependencies/${b.id}`), 404)).code).toBe(
      'DEPENDENCY_NOT_FOUND',
    );
  });

  it('assignee and assignable users; deletion with the version in the query', async () => {
    const task = await created();
    const vivi = clientFor(app, VIVI);

    const page = assignableUserPageSchema.parse(
      (await at(mia.get(`/tasks/assignable-users?projectId=${WEB}`), 200)).body,
    );
    expect(page.items.map((item) => item.userId).sort()).toEqual([ANA, BIA, MIA].sort());
    expect(problem(await at(vivi.get(`/tasks/assignable-users?projectId=${WEB}`), 403)).code).toBe(
      'INSUFFICIENT_ROLE',
    );
    const assigned = taskSchema.parse(
      (await at(mia.put(`/tasks/${task.id}/assignee`, { assigneeUserId: BIA, version: 1 }), 200))
        .body,
    );
    expect(assigned.assignee).toEqual({ userId: BIA, name: BIA.toUpperCase() });
    expect(
      problem(
        await at(mia.put(`/tasks/${task.id}/assignee`, { assigneeUserId: VIVI, version: 2 }), 422),
      ).code,
    ).toBe('ASSIGNEE_NOT_PROJECT_MEMBER');
    await at(mia.delete(`/tasks/${task.id}?version=2`), 204);
    expect(problem(await at(mia.get(`/tasks/${task.id}`), 404)).code).toBe('TASK_NOT_FOUND');
  });

  it('429 with Retry-After when tasks.write.user.hour is exhausted', async () => {
    const task = await created();
    bed.rateLimiter.consumed.set(`${TASK_WRITE_POLICY.name}|${MIA}`, TASK_WRITE_POLICY.points);

    const response = await at(mia.patch(`/tasks/${task.id}`, { title: 'Y', version: 1 }), 429);

    expect(problem(response).code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBeDefined();
  });

  describe('board (spec 005, T8)', () => {
    it('GET /board answers the contract; columns page with a cursor bound to the column', async () => {
      for (let index = 0; index < 3; index += 1)
        await created({ projectId: WEB, title: `C${index}` });

      const board = boardSchema.parse(
        (await at(mia.get(`/board?projectId=${WEB}&limit=2`), 200)).body,
      );
      expect(board.statuses.map((status) => status.id)).toEqual([TODO, DOING, DONE]);
      expect(board.columns[0]?.cards.map((card) => card.key)).toEqual(['WEB-1', 'WEB-2']);
      expect(board.columns[0]?.cards[0]?.subtasks).toEqual({ done: 0, total: 0 });
      expect(board.actions).toEqual({ move: true, configure: true });
      const cursor = board.columns[0]?.nextCursor ?? '';
      const next = columnPageSchema.parse(
        (await at(mia.get(`/board/columns/${TODO}?projectId=${WEB}&cursor=${cursor}`), 200)).body,
      );
      expect(next.cards.map((card) => card.key)).toEqual(['WEB-3']);
      expect(
        problem(await at(mia.get(`/board/columns/${DOING}?projectId=${WEB}&cursor=${cursor}`), 400))
          .code,
      ).toBe('INVALID_CURSOR');
      expect(
        problem(await at(mia.get(`/board/columns/not-a-uuid?projectId=${WEB}`), 404)).code,
      ).toBe('STATUS_NOT_FOUND');
      expect(problem(await at(mia.get(`/board?projectId=${HIDDEN}`), 404)).code).toBe(
        'PROJECT_NOT_FOUND',
      );
      expect(problem(await at(mia.get(`/board?projectId=${WEB}&limit=51`), 400)).code).toBe(
        'VALIDATION_FAILED',
      );
    });

    it('POST /tasks/{id}/move reorders and changes column; contract errors 400/422', async () => {
      const a = await created({ projectId: WEB, title: 'A' });
      const b = await created({ projectId: WEB, title: 'B' });
      const sub = await created({ projectId: WEB, title: 'S', parentTaskId: a.id });

      const moved = moveCardResponseSchema.parse(
        (
          await at(
            mia.post(`/tasks/${b.id}/move`, { toStatusId: TODO, beforeTaskId: a.id, version: 1 }),
            200,
          )
        ).body,
      );
      expect(moved).toMatchObject({ statusId: TODO, card: { key: 'WEB-2', version: 1 } });
      const order = boardSchema.parse((await at(mia.get(`/board?projectId=${WEB}`), 200)).body);
      expect(order.columns[0]?.cards.map((card) => card.key)).toEqual(['WEB-2', 'WEB-1']);
      const doing = moveCardResponseSchema.parse(
        (await at(mia.post(`/tasks/${a.id}/move`, { toStatusId: DOING, version: 1 }), 200)).body,
      );
      expect(doing.card).toMatchObject({
        status: { id: DOING },
        version: 2,
        subtasks: { done: 0, total: 1 },
      });
      expect(
        problem(
          await at(
            mia.post(`/tasks/${b.id}/move`, {
              toStatusId: TODO,
              afterTaskId: a.id,
              beforeTaskId: a.id,
              version: 1,
            }),
            400,
          ),
        ).code,
      ).toBe('VALIDATION_FAILED');
      expect(
        problem(
          await at(
            mia.post(`/tasks/${b.id}/move`, { toStatusId: TODO, afterTaskId: a.id, version: 1 }),
            422,
          ),
        ).code,
      ).toBe('INVALID_POSITION');
      expect(
        problem(await at(mia.post(`/tasks/${sub.id}/move`, { toStatusId: TODO, version: 1 }), 422))
          .code,
      ).toBe('TASK_NOT_A_CARD');
      expect(
        problem(await at(mia.post(`/tasks/${b.id}/move`, { toStatusId: DONE, version: 1 }), 422))
          .code,
      ).toBe('TRANSITION_NOT_ALLOWED');
      expect(
        problem(
          await at(
            clientFor(app, VIVI).post(`/tasks/${b.id}/move`, { toStatusId: TODO, version: 1 }),
            403,
          ),
        ).code,
      ).toBe('INSUFFICIENT_ROLE');
    });
  });

  it('mutations without the CSRF token are refused before any use case', async () => {
    const response = await request(app)
      .post(`${BASE}/tasks`)
      .set('x-test-user', MIA)
      .set('Origin', APP_ORIGIN)
      .send({ projectId: WEB, title: 'X' })
      .expect(403);

    expect(problem(response).code).not.toBe('INSUFFICIENT_ROLE');
    expect(bed.tasks.rows).toEqual([]);
  });
});
