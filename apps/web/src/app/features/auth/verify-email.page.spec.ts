import { TestBed } from '@angular/core/testing';
import {
  click,
  flushed,
  openAuthPage,
  problem,
  root,
  type AuthPageEnv,
} from './auth-pages.testing';
import { PendingEmailVerification } from './link-token';

const CONFIRM = '/api/v1/auth/email-verification/confirm';
const RESEND = '/api/v1/auth/email-verification/resend';
const TOKEN = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF12';
const ana = {
  id: '01a11e1a-99fa-7501-a131-4ad99a122005',
  name: 'Ana',
  email: 'ana@exemplo.com',
  emailVerified: false,
};

describe('VerifyEmailPage', () => {
  let env: AuthPageEnv;

  afterEach(() => {
    env.backend.verify();
    history.replaceState(null, '', '/');
  });

  const state = () =>
    root(env).querySelector<HTMLElement>('[data-testid="verify-email-state"]')?.dataset['state'];
  const pending = () => TestBed.inject(PendingEmailVerification).current();
  const signedIn =
    (user = ana) =>
    (store: { signIn: (u: typeof ana) => void }) =>
      store.signIn(user);

  it('asks an anonymous visitor to sign in and confirms nothing on its own (CA-03, CA-16)', async () => {
    env = await openAuthPage(`/verify-email#token=${TOKEN}`);

    expect(state()).toBe('needs_login');
    env.backend.expectNone(CONFIRM);
    expect(location.hash).toBe('');
    expect(pending()).toBe(TOKEN);

    await click(env, 'Entrar para confirmar');
    expect(env.router.url).toBe('/login?returnUrl=%2Fverify-email');
  });

  it('requires an explicit click to confirm when signed in (CA-03)', async () => {
    env = await openAuthPage(`/verify-email#token=${TOKEN}`, signedIn());

    expect(state()).toBe('ready');
    expect(root(env).textContent).toContain('ana@exemplo.com');
    env.backend.expectNone(CONFIRM);

    await click(env, 'Confirmar e-mail');
    const request = env.backend.expectOne({ method: 'POST', url: CONFIRM });
    expect(request.request.body).toEqual({ token: TOKEN });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await flushed(env);

    expect(state()).toBe('verified');
    expect(env.store.user()?.emailVerified).toBe(true);
    expect(pending()).toBeNull();
    expect(document.activeElement?.getAttribute('data-testid')).toBe('verify-email-state');
  });

  it('uses the token kept in memory after the visitor signs in', async () => {
    env = await openAuthPage('/verify-email', (store) => {
      TestBed.inject(PendingEmailVerification).remember(TOKEN);
      store.signIn(ana);
    });

    expect(state()).toBe('ready');
  });

  it('keeps the token when it belongs to another account, so the right account can use it', async () => {
    env = await openAuthPage(`/verify-email#token=${TOKEN}`, signedIn());

    await click(env, 'Confirmar e-mail');
    env.backend
      .expectOne(CONFIRM)
      .flush(problem('TOKEN_BELONGS_TO_ANOTHER_ACCOUNT', { status: 403 }), {
        status: 403,
        statusText: 'Forbidden',
      });
    await flushed(env);

    expect(state()).toBe('wrong_account');
    expect(pending()).toBe(TOKEN);
    expect(env.store.user()?.emailVerified).toBe(false);
  });

  it('offers a new link when the token is invalid or expired', async () => {
    env = await openAuthPage(`/verify-email#token=${TOKEN}`, signedIn());

    await click(env, 'Confirmar e-mail');
    env.backend.expectOne(CONFIRM).flush(problem('INVALID_OR_EXPIRED_TOKEN', { status: 400 }), {
      status: 400,
      statusText: 'Bad Request',
    });
    await flushed(env);
    expect(state()).toBe('invalid_link');
    expect(pending()).toBeNull();

    await click(env, 'Enviar novo link');
    env.backend
      .expectOne({ method: 'POST', url: RESEND })
      .flush(null, { status: 202, statusText: 'Accepted' });
    await flushed(env);

    expect(state()).toBe('resend_sent');
  });

  it('treats a second use as already confirmed (CA-03)', async () => {
    env = await openAuthPage(`/verify-email#token=${TOKEN}`, signedIn());

    await click(env, 'Confirmar e-mail');
    env.backend.expectOne(CONFIRM).flush(problem('EMAIL_ALREADY_VERIFIED', { status: 409 }), {
      status: 409,
      statusText: 'Conflict',
    });
    await flushed(env);

    expect(state()).toBe('already_verified');
    expect(env.store.user()?.emailVerified).toBe(true);
  });

  it('does not call the API when the signed-in account is already verified', async () => {
    env = await openAuthPage(
      `/verify-email#token=${TOKEN}`,
      signedIn({ ...ana, emailVerified: true }),
    );

    expect(state()).toBe('already_verified');
    expect(pending()).toBeNull();
    env.backend.expectNone(CONFIRM);
  });

  it('explains how to proceed when there is no token', async () => {
    env = await openAuthPage('/verify-email');

    expect(state()).toBe('no_token');
    expect(root(env).querySelectorAll('button')).toHaveLength(0);
  });

  it('keeps the page and reports throttling without losing the token', async () => {
    env = await openAuthPage(`/verify-email#token=${TOKEN}`, signedIn());

    await click(env, 'Confirmar e-mail');
    env.backend.expectOne(CONFIRM).flush(problem('RATE_LIMITED', { status: 429 }), {
      status: 429,
      statusText: 'Too Many Requests',
    });
    await flushed(env);

    expect(state()).toBe('ready');
    expect(root(env).querySelector('[role="alert"]')?.textContent).toContain('Muitas tentativas');
    expect(pending()).toBe(TOKEN);
  });
});
