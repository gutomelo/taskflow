import express, { type RequestHandler } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request, { type Response } from 'supertest';
import {
  CreateCommentUseCase,
  DeleteCommentUseCase,
  EditCommentUseCase,
  GetCommentUseCase,
  ListCommentsUseCase,
  ListMentionCandidatesUseCase,
} from '@taskflow/backend/collaboration/application';
import {
  createCollaborationTestbed,
  type CollaborationTestbed,
} from '@taskflow/backend/collaboration/application/testing';
import {
  createCsrfProtection,
  createErrorHandler,
  createTenantScope,
  HttpError,
  notFoundHandler,
} from '@taskflow/backend/shared/http';
import type { OrganizationRole, ProjectRole } from '@taskflow/backend/shared/kernel';
import {
  commentPageSchema,
  commentSchema,
  mentionCandidatePageSchema,
  problemDetailsSchema,
} from '@taskflow/contracts';
import { collaborationErrorMappings } from './collaboration-error-mappings';
import { createCollaborationRouter } from './collaboration-router';

const APP_ORIGIN = 'http://localhost:4200';
const uuid = (suffix: string) => `0192a000-0000-7000-8000-${suffix.padStart(12, '0')}`;
const ORG = uuid('f0f0');
const WEB = uuid('ae00');
const TASK = uuid('7a01');
const MIA = uuid('a1a1'); // manager
const BIA = uuid('b1b1'); // member
const VIVI = uuid('d1d1'); // viewer
const OTTO = uuid('c1c1'); // sem acesso
const BASE = `/api/v1/organizations/${ORG}`;

function world(): CollaborationTestbed {
  const bed = createCollaborationTestbed();
  bed.discussion.addTask({
    organizationId: ORG,
    projectId: WEB,
    taskId: TASK,
    archived: false,
    canceled: false,
  });
  const people: Array<[string, string, ProjectRole | null]> = [
    [MIA, 'Mia', 'manager'],
    [BIA, 'Bia', 'member'],
    [VIVI, 'Vivi', 'viewer'],
    [OTTO, 'Otto', null],
  ];
  for (const [userId, name, role] of people) {
    bed.discussion.setRole(ORG, WEB, userId, role);
    bed.discussion.people.set(userId, { name, email: `${name.toLowerCase()}@exemplo.com` });
    bed.users.names.set(userId, name);
    bed.users.members.add(`${ORG}|${userId}`);
  }
  return bed;
}

function buildApp(bed: CollaborationTestbed) {
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
  const router = createCollaborationRouter({
    useCases: {
      listComments: new ListCommentsUseCase(bed),
      getComment: new GetCommentUseCase(bed),
      listMentionCandidates: new ListMentionCandidatesUseCase(bed),
      createComment: new CreateCommentUseCase(bed),
      editComment: new EditCommentUseCase(bed),
      deleteComment: new DeleteCommentUseCase(bed),
    },
  });
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.use(express.json());
  app.get('/test/csrf', authenticate, (req, res) => {
    csrf.issue(res, req.actor?.sessionId);
    res.status(204).end();
  });
  const organizationRole: OrganizationRole = 'member';
  app.use(
    '/api/v1',
    createTenantScope({
      authenticate,
      csrf,
      resolve: async ({ organizationId }) => (organizationId === ORG ? { organizationRole } : null),
      routers: [router],
    }),
  );
  app.use(notFoundHandler);
  app.use(createErrorHandler({ domainErrors: collaborationErrorMappings }));
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
  const mutate = async (method: 'post' | 'patch' | 'delete', path: string, body?: object) => {
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
    post: (path: string, body: object) => mutate('post', path, body),
    patch: (path: string, body: object) => mutate('patch', path, body),
    delete: (path: string) => mutate('delete', path),
  };
}

const problem = (response: Response) => problemDetailsSchema.parse(response.body);

async function at(pending: PromiseLike<Response>, status: number): Promise<Response> {
  const response = await pending;
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
}

describe('collaboration router (spec 010, T7)', () => {
  let bed: CollaborationTestbed;
  let app: express.Express;
  let bia: ReturnType<typeof clientFor>;

  beforeEach(() => {
    bed = world();
    app = buildApp(bed);
    bia = clientFor(app, BIA);
  });

  it('creates (201 + Location), reads, lists, edits and removes — all matching the contracts', async () => {
    const response = await at(bia.post(`/tasks/${TASK}/comments`, { body: `oi <@${MIA}>` }), 201);
    const created = commentSchema.parse(response.body);
    expect(response.headers['location']).toBe(`${BASE}/comments/${created.id}`);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(created).toMatchObject({
      author: { userId: BIA, name: 'Bia' },
      mentions: [{ userId: MIA, name: 'Mia' }],
      version: 1,
      editedAt: null,
    });

    expect(commentSchema.parse((await at(bia.get(`/comments/${created.id}`), 200)).body)).toEqual(
      created,
    );
    const page = commentPageSchema.parse((await at(bia.get(`/tasks/${TASK}/comments`), 200)).body);
    expect(page).toMatchObject({ count: 1, nextCursor: null, actions: { comment: true } });

    const edited = commentSchema.parse(
      (await at(bia.patch(`/comments/${created.id}`, { body: 'oi', version: 1 }), 200)).body,
    );
    expect(edited).toMatchObject({ version: 2, mentions: [] });
    await at(bia.delete(`/comments/${created.id}?version=2`), 204);
    await at(bia.delete(`/comments/${created.id}?version=2`), 204);
    expect(
      commentSchema.parse((await at(bia.get(`/comments/${created.id}`), 200)).body),
    ).toMatchObject({ body: null, version: 3 });
  });

  it('mention candidates match the contract, without the user', async () => {
    const page = mentionCandidatePageSchema.parse(
      (await at(bia.get(`/tasks/${TASK}/mentionable-users?query=i`), 200)).body,
    );
    // Otto não lê o projeto; Bia é quem busca.
    expect(page.items.map((item) => item.name)).toEqual(['Mia', 'Vivi']);
    await at(bia.get(`/tasks/${TASK}/mentionable-users`), 400);
    await at(bia.get(`/tasks/${TASK}/mentionable-users?query=${'a'.repeat(51)}`), 400);
  });

  it('400: unknown fields, mention lists or authors in the body, missing version, bad text', async () => {
    const created = commentSchema.parse(
      (await at(bia.post(`/tasks/${TASK}/comments`, { body: 'oi' }), 201)).body,
    );
    for (const body of [
      { body: 'oi', mentions: [MIA] },
      { body: 'oi', authorUserId: MIA },
      { body: 'oi', organizationId: ORG },
      { body: '' },
      {},
    ]) {
      expect(problem(await at(bia.post(`/tasks/${TASK}/comments`, body), 400)).code).toBe(
        'VALIDATION_FAILED',
      );
    }
    expect(problem(await at(bia.post(`/tasks/${TASK}/comments`, { body: '   ' }), 400)).code).toBe(
      'INVALID_COMMENT_BODY',
    );
    await at(bia.patch(`/comments/${created.id}`, { body: 'x' }), 400);
    await at(bia.delete(`/comments/${created.id}`), 400);
    await at(bia.get(`/tasks/${TASK}/comments?limit=101`), 400);
    expect(problem(await at(bia.get(`/tasks/${TASK}/comments?cursor=lixo`), 400)).code).toBe(
      'INVALID_CURSOR',
    );
  });

  it('404: malformed or hidden ids answer as missing, with one code per kind of route', async () => {
    const created = commentSchema.parse(
      (await at(bia.post(`/tasks/${TASK}/comments`, { body: 'oi' }), 201)).body,
    );
    const otto = clientFor(app, OTTO);
    for (const pending of [
      bia.get('/tasks/nao-e-uuid/comments'),
      bia.get(`/tasks/${uuid('dead')}/comments`),
      otto.get(`/tasks/${TASK}/comments`),
    ]) {
      expect(problem(await at(pending, 404)).code).toBe('TASK_NOT_FOUND');
    }
    const missing = problem(await at(bia.get(`/comments/${uuid('dead')}`), 404));
    const hidden = problem(await at(otto.get(`/comments/${created.id}`), 404));
    const malformed = problem(
      await at(bia.patch('/comments/nao-e-uuid', { body: 'x', version: 1 }), 404),
    );
    expect([missing.code, hidden.code, malformed.code]).toEqual([
      'COMMENT_NOT_FOUND',
      'COMMENT_NOT_FOUND',
      'COMMENT_NOT_FOUND',
    ]);
    expect(hidden.title).toBe(missing.title);
  });

  it('403, 409 and 422 map to the problem codes', async () => {
    const vivi = clientFor(app, VIVI);
    const created = commentSchema.parse(
      (await at(bia.post(`/tasks/${TASK}/comments`, { body: 'oi' }), 201)).body,
    );
    expect(problem(await at(vivi.post(`/tasks/${TASK}/comments`, { body: 'oi' }), 403)).code).toBe(
      'INSUFFICIENT_ROLE',
    );
    expect(problem(await at(vivi.get(`/tasks/${TASK}/mentionable-users?query=a`), 403)).code).toBe(
      'INSUFFICIENT_ROLE',
    );
    expect(
      problem(await at(bia.patch(`/comments/${created.id}`, { body: 'x', version: 9 }), 409)).code,
    ).toBe('VERSION_CONFLICT');
    expect(
      problem(await at(bia.post(`/tasks/${TASK}/comments`, { body: `<@${OTTO}>` }), 422)).code,
    ).toBe('INVALID_MENTION');
    const [task] = bed.discussion.tasks;
    if (task) task.canceled = true;
    expect(problem(await at(bia.post(`/tasks/${TASK}/comments`, { body: 'oi' }), 409)).code).toBe(
      'TASK_CANCELED',
    );
  });

  it('mutations require the CSRF token', async () => {
    const response = await request(app)
      .post(`${BASE}/tasks/${TASK}/comments`)
      .set('x-test-user', BIA)
      .send({ body: 'oi' });
    expect(response.status).toBe(403);
    expect(bed.comments.rows).toEqual([]);
  });
});
