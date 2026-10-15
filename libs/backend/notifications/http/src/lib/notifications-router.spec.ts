import express, { type RequestHandler } from 'express';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import request, { type Response } from 'supertest';
import {
  CountUnreadUseCase,
  GetNotificationPreferenceUseCase,
  ListNotificationsUseCase,
  MarkAllReadUseCase,
  MarkReadUseCase,
  RecordNotificationsUseCase,
  UpdateNotificationPreferenceUseCase,
} from '@taskflow/backend/notifications/application';
import {
  createNotificationsTestbed,
  type NotificationsTestbed,
} from '@taskflow/backend/notifications/application/testing';
import {
  createCsrfProtection,
  createErrorHandler,
  createTenantScope,
  HttpError,
  notFoundHandler,
} from '@taskflow/backend/shared/http';
import {
  notificationPageSchema,
  notificationPreferenceSchema,
  problemDetailsSchema,
  unreadCountSchema,
} from '@taskflow/contracts';
import { notificationsErrorMappings } from './notifications-error-mappings';
import { createNotificationsRouters } from './notifications-router';

const APP_ORIGIN = 'http://localhost:4200';
const uuid = (suffix: string) => `0192a000-0000-7000-8000-${suffix.padStart(12, '0')}`;
const ORG = uuid('f0f0');
const [ANA, BIA, CAIO] = [uuid('a1'), uuid('b1'), uuid('c1')];
const TASK = uuid('7a01');

async function world(): Promise<NotificationsTestbed> {
  const bed = createNotificationsTestbed();
  for (const userId of [ANA, BIA, CAIO]) {
    bed.notifications.members.add(`${ORG}|${userId}`);
    bed.people.join(ORG, userId, 'acme', 'member');
  }
  bed.people.names.set(ANA, 'Ana');
  bed.notifications.tasks.add(TASK);
  bed.targets.tasks.set(TASK, {
    organizationId: ORG,
    key: 'WEB-1',
    title: 'Login',
    readers: new Set([BIA, CAIO]),
  });
  const record = new RecordNotificationsUseCase(bed);
  for (const [recipient, index] of [
    [BIA, 1],
    [BIA, 2],
    [CAIO, 3],
  ] as const) {
    await record.execute({
      kind: 'assignment',
      organizationId: ORG,
      projectId: uuid('ae00'),
      taskId: TASK,
      commentId: null,
      actorUserId: ANA,
      recipientUserIds: [recipient],
      sourceEventId: uuid(`e${index}`),
      occurredAt: new Date(Date.UTC(2026, 9, 15, 10, index)),
    });
  }
  return bed;
}

function buildApp(bed: NotificationsTestbed) {
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
  const routers = createNotificationsRouters({
    useCases: {
      listNotifications: new ListNotificationsUseCase(bed),
      countUnread: new CountUnreadUseCase(bed),
      markRead: new MarkReadUseCase(bed),
      markAllRead: new MarkAllReadUseCase(bed),
      getPreference: new GetNotificationPreferenceUseCase(bed),
      updatePreference: new UpdateNotificationPreferenceUseCase(bed),
    },
    authenticate,
    csrf,
  });
  const app = express();
  app.use(pinoHttp({ logger: pino({ level: 'silent' }) }));
  app.use(express.json());
  app.get('/test/csrf', authenticate, (req, res) => {
    csrf.issue(res, req.actor?.sessionId);
    res.status(204).end();
  });
  app.use('/api/v1', routers.globalRouter);
  app.use(
    '/api/v1',
    createTenantScope({
      authenticate,
      csrf,
      resolve: async ({ organizationId }) =>
        organizationId === ORG ? { organizationRole: 'member' } : null,
      routers: [routers.tenantRouter],
    }),
  );
  app.use(notFoundHandler);
  app.use(createErrorHandler({ domainErrors: notificationsErrorMappings }));
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
  const mutate = async (method: 'post' | 'put', path: string, body: object) => {
    const value = await token();
    return request(app)
      [method](`/api/v1${path}`)
      .set('x-test-user', userId)
      .set('Cookie', [`__Host-tf_csrf=${value}`])
      .set('Origin', APP_ORIGIN)
      .set('X-CSRF-Token', value)
      .send(body);
  };
  return {
    get: (path: string) => request(app).get(`/api/v1${path}`).set('x-test-user', userId),
    post: (path: string, body: object = {}) => mutate('post', path, body),
    put: (path: string, body: object) => mutate('put', path, body),
  };
}

async function at(pending: PromiseLike<Response>, status: number): Promise<Response> {
  const response = await pending;
  expect(response.status, JSON.stringify(response.body)).toBe(status);
  return response;
}
const problem = (response: Response) => problemDetailsSchema.parse(response.body);

describe('notifications router (spec 008, T7)', () => {
  let bed: NotificationsTestbed;
  let bia: ReturnType<typeof clientFor>;
  let app: express.Express;

  beforeEach(async () => {
    bed = await world();
    app = buildApp(bed);
    bia = clientFor(app, BIA);
  });

  it('lists, counts and marks read — matching the contracts', async () => {
    const page = notificationPageSchema.parse(
      (await at(bia.get(`/organizations/${ORG}/notifications`), 200)).body,
    );
    expect(page.items.map((item) => [item.kind, item.task.key, item.actor.name])).toEqual([
      ['assignment', 'WEB-1', 'Ana'],
      ['assignment', 'WEB-1', 'Ana'],
    ]);
    expect(
      unreadCountSchema.parse(
        (await at(bia.get(`/organizations/${ORG}/notifications/unread-count`), 200)).body,
      ),
    ).toEqual({
      count: 2,
      capped: false,
    });

    await at(bia.post(`/organizations/${ORG}/notifications/${page.items[1]?.id ?? ''}/read`), 204);
    expect((await bia.get(`/organizations/${ORG}/notifications/unread-count`)).body).toEqual({
      count: 1,
      capped: false,
    });
    await at(
      bia.post(`/organizations/${ORG}/notifications/read-all`, { upToId: page.items[0]?.id }),
      204,
    );
    expect((await bia.get(`/organizations/${ORG}/notifications/unread-count`)).body).toEqual({
      count: 0,
      capped: false,
    });
  });

  it("404 for someone else's, missing or malformed ids; 400 for bad input", async () => {
    const ofCaio = bed.notifications.rows.find((row) => row.recipientUserId === CAIO);
    for (const id of [ofCaio?.id ?? '', uuid('dead'), 'nao-e-uuid']) {
      expect(
        problem(await at(bia.post(`/organizations/${ORG}/notifications/${id}/read`), 404)).code,
      ).toBe('NOTIFICATION_NOT_FOUND');
    }
    expect(
      problem(
        await at(
          bia.post(`/organizations/${ORG}/notifications/read-all`, { upToId: ofCaio?.id }),
          404,
        ),
      ).code,
    ).toBe('NOTIFICATION_NOT_FOUND');
    expect(
      problem(
        await at(bia.post(`/organizations/${ORG}/notifications/read-all`, { all: true }), 400),
      ).code,
    ).toBe('VALIDATION_FAILED');
    expect(
      problem(await at(bia.get(`/organizations/${ORG}/notifications?cursor=lixo`), 400)).code,
    ).toBe('INVALID_CURSOR');
    await at(bia.get(`/organizations/${ORG}/notifications?limit=51`), 400);
    expect(bed.notifications.rows.find((row) => row.id === ofCaio?.id)?.readAt).toBeNull();
  });

  it('preferences of the own account: on by default, saved with CSRF, unknown fields refused', async () => {
    expect(
      notificationPreferenceSchema.parse(
        (await at(bia.get('/me/notification-preferences'), 200)).body,
      ),
    ).toEqual({
      emailDigest: true,
    });
    await at(bia.put('/me/notification-preferences', { emailDigest: false }), 200);
    expect((await bia.get('/me/notification-preferences')).body).toEqual({ emailDigest: false });
    await at(bia.put('/me/notification-preferences', { emailDigest: true, userId: CAIO }), 400);
    expect(await bed.preferences.emailDigest(CAIO)).toBe(true);

    const withoutCsrf = await request(app)
      .put('/api/v1/me/notification-preferences')
      .set('x-test-user', BIA)
      .send({ emailDigest: true });
    expect(withoutCsrf.status).toBe(403);
    await at(request(app).get('/api/v1/me/notification-preferences'), 401);
  });
});
