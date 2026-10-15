import request from 'supertest';
import type { Actor } from '@taskflow/backend/shared/application';
import { createTestApp } from '../testing/test-app';
import { createAuthenticate, requestContextFrom } from './authenticate';

const COOKIE = '__Host-tf_at';
const validActor: Actor = { userId: 'user-1', sessionId: 'session-1' };

function buildApp(resolveActor: (token: string) => Promise<Actor | null>, required?: boolean) {
  return createTestApp((app) => {
    app.get(
      '/me',
      createAuthenticate({
        cookieName: COOKIE,
        resolveActor,
        ...(required === undefined ? {} : { required }),
      }),
      (req, res) => {
        res.json({ actor: req.actor ?? null, context: req.actor ? requestContextFrom(req) : null });
      },
    );
  });
}

describe('createAuthenticate', () => {
  it('rejects requests without the access token cookie', async () => {
    const resolveActor = vi.fn(async () => validActor);

    const response = await request(buildApp(resolveActor)).get('/me').expect(401);

    expect(response.body.code).toBe('UNAUTHENTICATED');
    expect(resolveActor).not.toHaveBeenCalled();
  });

  it('rejects tokens the resolver considers invalid or revoked', async () => {
    await request(buildApp(async () => null))
      .get('/me')
      .set('Cookie', `${COOKIE}=expired-or-revoked`)
      .expect(401);
  });

  it('exposes the actor and a request context for valid tokens', async () => {
    const resolveActor = vi.fn(async () => validActor);

    const response = await request(buildApp(resolveActor))
      .get('/me')
      .set('Cookie', `${COOKIE}=valid-token; other=1`)
      .expect(200);

    expect(resolveActor).toHaveBeenCalledWith('valid-token');
    expect(response.body.actor).toEqual(validActor);
    expect(response.body.context).toMatchObject({
      actor: validActor,
      requestId: expect.any(String),
    });
  });

  it('lets anonymous requests through when authentication is optional', async () => {
    const response = await request(buildApp(async () => null, false))
      .get('/me')
      .expect(200);

    expect(response.body.actor).toBeNull();
  });

  it('fails closed with a generic 500 when the resolver infrastructure fails', async () => {
    const response = await request(
      buildApp(async () => {
        throw new Error('redis down: connection details');
      }),
    )
      .get('/me')
      .set('Cookie', `${COOKIE}=valid-token`)
      .expect(500);

    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(response.text).not.toContain('redis down');
  });
});
