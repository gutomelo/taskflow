import {
  field,
  flushed,
  openAuthPage,
  problem,
  root,
  submit,
  type,
  type AuthPageEnv,
} from './auth-pages.testing';

const FORGOT = '/api/v1/auth/password/forgot';
const RESET = '/api/v1/auth/password/reset';
const TOKEN = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF12';

describe('ForgotPasswordPage', () => {
  let env: AuthPageEnv;

  beforeEach(async () => {
    env = await openAuthPage('/forgot-password');
  });

  afterEach(() => env.backend.verify());

  it('shows the same answer whether or not the e-mail has an account (BR-014)', async () => {
    await type(env, 'E-mail', ' ana@exemplo.com ');
    await submit(env);

    const request = env.backend.expectOne({ method: 'POST', url: FORGOT });
    expect(request.request.body).toEqual({ email: 'ana@exemplo.com' });
    request.flush(null, { status: 202, statusText: 'Accepted' });
    await flushed(env);

    const sent = root(env).querySelector('[data-testid="forgot-sent"]');
    expect(sent?.textContent).toContain('Se houver uma conta com ana@exemplo.com');
    expect(sent?.textContent).toContain('30 minutos');
    expect(document.activeElement).toBe(sent);
  });

  it('validates the e-mail on the client', async () => {
    await type(env, 'E-mail', 'ana');
    await submit(env);

    expect(root(env).textContent).toContain('Informe um e-mail válido');
    expect(document.activeElement).toBe(field(env, 'E-mail'));
    env.backend.expectNone(FORGOT);
  });

  it('reports throttling (CA-10)', async () => {
    await type(env, 'E-mail', 'ana@exemplo.com');
    await submit(env);
    env.backend.expectOne(FORGOT).flush(problem('RATE_LIMITED', { status: 429 }), {
      status: 429,
      statusText: 'Too Many Requests',
    });
    await flushed(env);

    expect(root(env).querySelector('[role="alert"]')?.textContent).toContain('Muitas tentativas');
  });
});

describe('ResetPasswordPage', () => {
  let env: AuthPageEnv;

  afterEach(() => {
    env.backend.verify();
    history.replaceState(null, '', '/');
  });

  const resetState = () => root(env).querySelector('[data-testid="reset-state"]')?.textContent;
  const requirement = (rule: string) => root(env).querySelector(`[data-rule="${rule}"]`);

  it('shows an invalid-link message when there is no token', async () => {
    env = await openAuthPage('/reset-password');

    expect(resetState()).toContain('Links de redefinição valem 30 minutos');
    expect(root(env).querySelector('form')).toBeNull();
  });

  it('resets the password, ends the local session and points to the login (BR-016)', async () => {
    env = await openAuthPage(`/reset-password#token=${TOKEN}`, (store) =>
      store.signIn({
        id: '01a11e1a-99fa-7501-a131-4ad99a122005',
        name: 'Ana',
        email: 'ana@exemplo.com',
        emailVerified: true,
      }),
    );
    expect(location.hash).toBe('');

    await type(env, 'Nova senha', 'Nova-Senha-2026');
    await submit(env);
    const request = env.backend.expectOne({ method: 'POST', url: RESET });
    expect(request.request.body).toEqual({ token: TOKEN, newPassword: 'Nova-Senha-2026' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await flushed(env);

    expect(resetState()).toContain('todas as sessões abertas foram encerradas');
    expect(env.store.isAuthenticated()).toBe(false);
  });

  it('does not show the e-mail rule, since there is no e-mail on this page', async () => {
    env = await openAuthPage(`/reset-password#token=${TOKEN}`);

    expect(requirement('min_length')).not.toBeNull();
    expect(requirement('same_as_email')).toBeNull();
  });

  it('shows rules refused by the server, including one the page cannot check', async () => {
    env = await openAuthPage(`/reset-password#token=${TOKEN}`);

    await type(env, 'Nova senha', 'Ana@Exemplo.com1');
    await submit(env);
    env.backend.expectOne(RESET).flush(
      problem('PASSWORD_POLICY_VIOLATION', {
        status: 422,
        violations: [{ field: 'password', message: 'same_as_email' }],
      }),
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await flushed(env);

    expect(requirement('same_as_email')?.getAttribute('data-met')).toBe('false');
    expect(root(env).querySelector('[role="alert"]')?.textContent).toContain('requisitos');
  });

  it('moves to the invalid-link state when the token was already used or expired', async () => {
    env = await openAuthPage(`/reset-password#token=${TOKEN}`);

    await type(env, 'Nova senha', 'Nova-Senha-2026');
    await submit(env);
    env.backend.expectOne(RESET).flush(problem('INVALID_OR_EXPIRED_TOKEN', { status: 400 }), {
      status: 400,
      statusText: 'Bad Request',
    });
    await flushed(env);

    expect(resetState()).toContain('Links de redefinição valem 30 minutos');
    expect(document.activeElement?.getAttribute('data-testid')).toBe('reset-state');
  });

  it('blocks a weak password on the client', async () => {
    env = await openAuthPage(`/reset-password#token=${TOKEN}`);

    await type(env, 'Nova senha', 'fraca');
    await submit(env);

    expect(document.activeElement).toBe(field(env, 'Nova senha'));
    env.backend.expectNone(RESET);
  });
});

describe('LoginPage links', () => {
  it('offers the forgot-password page', async () => {
    const env = await openAuthPage('/login');
    const link = [...root(env).querySelectorAll('a')].find((anchor) =>
      anchor.textContent?.includes('Esqueci minha senha'),
    );

    link?.click();
    await flushed(env);

    expect(env.router.url).toBe('/forgot-password');
  });
});
