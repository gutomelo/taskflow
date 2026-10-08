import request from 'supertest';
import { createTestApp, fakeActorFromHeader } from '../testing/test-app';
import { createCsrfProtection, CSRF_COOKIE_NAME } from './csrf';

const APP_ORIGIN = 'http://localhost:4200';

function buildApp() {
  const csrf = createCsrfProtection({
    appOrigin: APP_ORIGIN,
    secret: 's'.repeat(43),
    secureCookie: true,
  });
  return createTestApp((app) => {
    app.use(fakeActorFromHeader);
    app.get('/csrf', (req, res) => {
      csrf.issue(res, req.actor?.sessionId);
      res.status(204).end();
    });
    app.post('/mutate', csrf.require(), (_req, res) => {
      res.status(204).end();
    });
    app.get('/read', csrf.require(), (_req, res) => {
      res.status(204).end();
    });
    app.post(
      '/custom-binding',
      csrf.require((req) => req.get('x-binding') ?? 'anon'),
      (_req, res) => {
        res.status(204).end();
      },
    );
  });
}

async function issueToken(app: ReturnType<typeof buildApp>, sessionId?: string): Promise<string> {
  const response = await request(app)
    .get('/csrf')
    .set(sessionId ? { 'x-test-session': sessionId } : {});
  const setCookie = response.headers['set-cookie'];
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ''])[0] ?? '';
  const match = new RegExp(`${CSRF_COOKIE_NAME}=([^;]+)`).exec(cookie);
  if (!match?.[1]) throw new Error('CSRF cookie was not issued');
  return match[1];
}

function mutate(app: ReturnType<typeof buildApp>, token: string, path = '/mutate') {
  return request(app)
    .post(path)
    .set('Origin', APP_ORIGIN)
    .set('Cookie', `${CSRF_COOKIE_NAME}=${token}`)
    .set('X-CSRF-Token', token);
}

describe('CSRF protection', () => {
  it('issues a __Host- cookie readable by the SPA, Secure, SameSite=Strict, Path=/', async () => {
    const response = await request(buildApp()).get('/csrf');
    const cookie = String(response.headers['set-cookie']);

    expect(cookie).toMatch(new RegExp(`^${CSRF_COOKIE_NAME}=[\\w-]+\\.[\\w-]+;`));
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('HttpOnly');
    expect(cookie).not.toContain('Domain=');
  });

  it('lets safe methods through without a token', async () => {
    await request(buildApp()).get('/read').expect(204);
  });

  it('accepts a mutation with matching cookie, header and same origin', async () => {
    const app = buildApp();
    await mutate(app, await issueToken(app)).expect(204);
  });

  it('accepts a same-origin Referer when Origin is absent', async () => {
    const app = buildApp();
    const token = await issueToken(app);
    await request(app)
      .post('/mutate')
      .set('Referer', `${APP_ORIGIN}/login`)
      .set('Cookie', `${CSRF_COOKIE_NAME}=${token}`)
      .set('X-CSRF-Token', token)
      .expect(204);
  });

  it.each([
    ['neither Origin nor Referer', {}],
    ['a foreign Origin', { Origin: 'https://evil.example' }],
    ['a foreign Referer', { Referer: 'https://evil.example/page' }],
    ['a cross-site fetch', { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'cross-site' }],
    [
      'a same-site (sibling subdomain) fetch',
      { Origin: APP_ORIGIN, 'Sec-Fetch-Site': 'same-site' },
    ],
  ])('rejects a mutation with %s', async (_case, headers) => {
    const app = buildApp();
    const token = await issueToken(app);
    const response = await request(app)
      .post('/mutate')
      .set(headers)
      .set('Cookie', `${CSRF_COOKIE_NAME}=${token}`)
      .set('X-CSRF-Token', token)
      .expect(403);

    expect(response.body.code).toBe('CSRF_VALIDATION_FAILED');
  });

  it('rejects when the header is missing or differs from the cookie', async () => {
    const app = buildApp();
    const token = await issueToken(app);
    const otherToken = await issueToken(app);

    await request(app)
      .post('/mutate')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', `${CSRF_COOKIE_NAME}=${token}`)
      .expect(403);
    await request(app)
      .post('/mutate')
      .set('Origin', APP_ORIGIN)
      .set('Cookie', `${CSRF_COOKIE_NAME}=${token}`)
      .set('X-CSRF-Token', otherToken)
      .expect(403);
  });

  it('rejects a forged cookie+header pair with an invalid signature', async () => {
    const forged = 'attacker-chosen-value.attacker-signature';
    await mutate(buildApp(), forged).expect(403);
  });

  it('rejects an anonymous token once the request is authenticated (token bound to the session)', async () => {
    const app = buildApp();
    const anonymousToken = await issueToken(app);

    await mutate(app, anonymousToken).set('x-test-session', 'session-a').expect(403);
  });

  it('rejects a token bound to another session', async () => {
    const app = buildApp();
    const tokenForA = await issueToken(app, 'session-a');

    await mutate(app, tokenForA).set('x-test-session', 'session-a').expect(204);
    await mutate(app, tokenForA).set('x-test-session', 'session-b').expect(403);
  });

  it('uses a custom binding resolver when provided', async () => {
    const app = buildApp();
    const tokenForA = await issueToken(app, 'session-a');

    await mutate(app, tokenForA, '/custom-binding').set('x-binding', 'session-a').expect(204);
    await mutate(app, tokenForA, '/custom-binding').set('x-binding', 'session-b').expect(403);
  });
});
