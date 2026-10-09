import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { ana, csrfCookie, problem, settle, setupAuthTesting } from './auth.testing';

const SESSIONS = '/api/v1/me/sessions';
const REFRESH = '/api/v1/auth/refresh';
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('sessionRefreshInterceptor', () => {
  let env: ReturnType<typeof setupAuthTesting>;

  beforeEach(() => {
    env = setupAuthTesting();
  });

  afterEach(() => env.backend.verify());

  const get = (url = SESSIONS) => firstValueFrom(env.http.get(url));
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => {
        throw new Error('expected the request to fail');
      },
      (error: unknown) => error as HttpErrorResponse,
    );

  it('refreshes once for concurrent 401s and retries each original request once', async () => {
    env.store.signIn(ana);
    const responses = Promise.all([get(), get(), get()]);

    for (const request of env.backend.match(SESSIONS)) {
      request.flush(problem('UNAUTHENTICATED'), unauthorized);
    }
    await settle();
    env.backend
      .expectOne({ method: 'POST', url: REFRESH })
      .flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    const retries = env.backend.match(SESSIONS);
    expect(retries).toHaveLength(3);
    retries.forEach((request, index) => request.flush({ items: [index] }));

    expect(await responses).toEqual([{ items: [0] }, { items: [1] }, { items: [2] }]);
    expect(env.store.isAuthenticated()).toBe(true);
  });

  it('retries the original request when another request is already rotating (409)', async () => {
    env.store.signIn(ana);
    const response = get();

    env.backend.expectOne(SESSIONS).flush(problem('UNAUTHENTICATED'), unauthorized);
    await settle();
    env.backend
      .expectOne(REFRESH)
      .flush(problem('REFRESH_IN_PROGRESS'), { status: 409, statusText: 'Conflict' });
    await settle();
    env.backend.expectOne(SESSIONS).flush({ items: [] });

    expect(await response).toEqual({ items: [] });
  });

  it('does not refresh again when the retried request is still unauthorized', async () => {
    env.store.signIn(ana);
    const response = failure(get());

    env.backend.expectOne(SESSIONS).flush(problem('UNAUTHENTICATED'), unauthorized);
    await settle();
    env.backend.expectOne(REFRESH).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    env.backend.expectOne(SESSIONS).flush(problem('UNAUTHENTICATED'), unauthorized);

    expect((await response).status).toBe(401);
    env.backend.expectNone(REFRESH);
  });

  it('ends the session and sends a signed-in user to the login page when refresh is refused', async () => {
    env.store.signIn(ana);
    const responses = Promise.all([failure(get()), failure(get())]);

    for (const request of env.backend.match(SESSIONS)) {
      request.flush(problem('UNAUTHENTICATED'), unauthorized);
    }
    await settle();
    env.backend.expectOne(REFRESH).flush(problem('SESSION_REVOKED'), unauthorized);

    const errors = await responses;
    expect(errors.map((error) => error.status)).toEqual([401, 401]);
    expect(env.store.status()).toBe('anonymous');
    expect(env.navigate).toHaveBeenCalledTimes(1);
    expect(env.navigate).toHaveBeenCalledWith(['/login'], { queryParams: { returnUrl: '/' } });
  });

  it('does not redirect when nobody was signed in (bootstrap of an anonymous visitor)', async () => {
    const response = failure(get('/api/v1/me'));

    env.backend.expectOne('/api/v1/me').flush(problem('UNAUTHENTICATED'), unauthorized);
    await settle();
    env.backend.expectOne(REFRESH).flush(problem('SESSION_REVOKED'), unauthorized);

    expect((await response).status).toBe(401);
    expect(env.navigate).not.toHaveBeenCalled();
  });

  it('keeps the user signed in when the refresh fails for reasons other than the session', async () => {
    env.store.signIn(ana);
    const response = failure(get());

    env.backend.expectOne(SESSIONS).flush(problem('UNAUTHENTICATED'), unauthorized);
    await settle();
    env.backend
      .expectOne(REFRESH)
      .flush(problem('SERVICE_BUSY'), { status: 503, statusText: 'Service Unavailable' });

    expect((await response).status).toBe(401);
    expect(env.store.isAuthenticated()).toBe(true);
    expect(env.navigate).not.toHaveBeenCalled();
  });

  it.each([
    ['login (401 means wrong credentials)', '/api/v1/auth/login'],
    ['password reset', '/api/v1/auth/password/reset'],
    ['a non-API URL', '/health/ready'],
  ])('passes 401 through without refreshing for %s', async (_case, url) => {
    const response = failure(firstValueFrom(env.http.post(url, {})));

    env.backend.expectOne(url).flush(problem('INVALID_CREDENTIALS'), unauthorized);

    expect((await response).status).toBe(401);
    await settle();
    env.backend.expectNone(REFRESH);
  });

  it('does not refresh on errors other than 401', async () => {
    env.store.signIn(ana);
    const response = failure(get());

    env.backend
      .expectOne(SESSIONS)
      .flush(problem('CSRF_TOKEN_INVALID'), { status: 403, statusText: 'Forbidden' });

    expect((await response).status).toBe(403);
    await settle();
    env.backend.expectNone(REFRESH);
  });

  describe('CSRF (T29/B1)', () => {
    const PASSWORD = '/api/v1/me/password';
    const CSRF = '/api/v1/auth/csrf';
    const post = () =>
      firstValueFrom(env.http.post(PASSWORD, { currentPassword: 'a', newPassword: 'b' }));
    const csrfProblem = problem('CSRF_VALIDATION_FAILED');
    const forbidden = { status: 403, statusText: 'Forbidden' };

    it('retries a mutation after refresh with the CSRF token the refresh just re-issued', async () => {
      env.store.signIn(ana);
      const response = post();

      const original = env.backend.expectOne(PASSWORD);
      expect(original.request.headers.get('X-CSRF-Token')).toBe('csrf-1');
      original.flush(problem('UNAUTHENTICATED'), unauthorized);
      await settle();
      csrfCookie.value = 'csrf-2'; // Set-Cookie da resposta do refresh
      env.backend.expectOne(REFRESH).flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      const retry = env.backend.expectOne(PASSWORD);
      expect(retry.request.headers.get('X-CSRF-Token')).toBe('csrf-2');
      retry.flush(null, { status: 204, statusText: 'No Content' });

      await response;
    });

    it('recovers once from a desynchronized CSRF cookie by asking for a new token', async () => {
      env.store.signIn(ana);
      const response = post();

      env.backend.expectOne(PASSWORD).flush(csrfProblem, forbidden);
      await settle();
      csrfCookie.value = 'csrf-new';
      env.backend.expectOne(CSRF).flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      const retry = env.backend.expectOne(PASSWORD);
      expect(retry.request.headers.get('X-CSRF-Token')).toBe('csrf-new');
      retry.flush(null, { status: 204, statusText: 'No Content' });

      await response;
    });

    it('does not loop when the CSRF failure persists', async () => {
      env.store.signIn(ana);
      const response = failure(post());

      env.backend.expectOne(PASSWORD).flush(csrfProblem, forbidden);
      await settle();
      env.backend.expectOne(CSRF).flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      env.backend.expectOne(PASSWORD).flush(csrfProblem, forbidden);

      expect((await response).status).toBe(403);
      await settle();
      env.backend.expectNone(CSRF);
    });

    it('also recovers refresh and logout calls (no access cookie, other tab signed out)', async () => {
      const response = firstValueFrom(env.http.post('/api/v1/auth/logout', null));

      env.backend.expectOne('/api/v1/auth/logout').flush(csrfProblem, forbidden);
      await settle();
      env.backend.expectOne(CSRF).flush(null, { status: 204, statusText: 'No Content' });
      await settle();
      env.backend
        .expectOne('/api/v1/auth/logout')
        .flush(null, { status: 204, statusText: 'No Content' });

      await response;
    });

    it('leaves other 403 errors alone', async () => {
      env.store.signIn(ana);
      const response = failure(post());

      env.backend.expectOne(PASSWORD).flush(problem('CURRENT_PASSWORD_INCORRECT'), forbidden);

      expect((await response).status).toBe(403);
      await settle();
      env.backend.expectNone(CSRF);
    });
  });
});
