import { BOOTSTRAP_TIMEOUT_MS } from './auth-api';
import { ana, problem, settle, setupAuthTesting } from './auth.testing';

const CSRF = '/api/v1/auth/csrf';
const ME = '/api/v1/me';
const REFRESH = '/api/v1/auth/refresh';
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('AuthStore.bootstrap', () => {
  let env: ReturnType<typeof setupAuthTesting>;

  beforeEach(() => {
    env = setupAuthTesting();
  });

  afterEach(() => env.backend.verify());

  it('starts unknown, issues the CSRF cookie first and then loads the current user', async () => {
    expect(env.store.status()).toBe('unknown');
    const bootstrap = env.store.bootstrap();

    env.backend.expectOne(CSRF).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    env.backend.expectOne(ME).flush(ana);
    await bootstrap;

    expect(env.store.status()).toBe('authenticated');
    expect(env.store.user()).toEqual(ana);
  });

  it('restores the session with the refresh cookie when the access token has expired', async () => {
    const bootstrap = env.store.bootstrap();

    env.backend.expectOne(CSRF).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    env.backend.expectOne(ME).flush(problem('UNAUTHENTICATED'), unauthorized);
    await settle();
    env.backend.expectOne(REFRESH).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    env.backend.expectOne(ME).flush(ana);
    await bootstrap;

    expect(env.store.isAuthenticated()).toBe(true);
  });

  it('becomes anonymous without redirecting when there is no session', async () => {
    const bootstrap = env.store.bootstrap();

    env.backend.expectOne(CSRF).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    env.backend.expectOne(ME).flush(problem('UNAUTHENTICATED'), unauthorized);
    await settle();
    env.backend.expectOne(REFRESH).flush(problem('SESSION_REVOKED'), unauthorized);
    await bootstrap;

    expect(env.store.status()).toBe('anonymous');
    expect(env.navigate).not.toHaveBeenCalled();
  });

  it('opens as anonymous when the API is unavailable, even without the CSRF cookie', async () => {
    const bootstrap = env.store.bootstrap();

    env.backend.expectOne(CSRF).error(new ProgressEvent('error'));
    await settle();
    env.backend.expectOne(ME).error(new ProgressEvent('error'));
    await bootstrap;

    expect(env.store.status()).toBe('anonymous');
  });

  it('rejects a /me response that does not match the contract', async () => {
    const bootstrap = env.store.bootstrap();

    env.backend.expectOne(CSRF).flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    env.backend.expectOne(ME).flush({ id: 'user-1', passwordHash: 'x' });
    await bootstrap;

    expect(env.store.status()).toBe('anonymous');
  });

  it('gives up after the bootstrap timeout when the API hangs, so the app still opens', async () => {
    vi.useFakeTimers();
    try {
      const bootstrap = env.store.bootstrap();
      env.backend.expectOne(CSRF); // nunca responde
      await vi.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS);
      env.backend.expectOne(ME); // também nunca responde
      await vi.advanceTimersByTimeAsync(BOOTSTRAP_TIMEOUT_MS);
      await bootstrap;

      expect(env.store.status()).toBe('anonymous');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports whether a user was signed in when the session ends', () => {
    env.store.signIn(ana);

    expect(env.store.endSession()).toBe(true);
    expect(env.store.endSession()).toBe(false);
    expect(env.store.user()).toBeNull();
  });
});
