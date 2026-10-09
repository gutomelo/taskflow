import { HttpHeaders } from '@angular/common/http';
import {
  field,
  openAuthPage,
  problem,
  root,
  settle,
  submit,
  type,
  type AuthPageEnv,
} from './auth-pages.testing';

const LOGIN = '/api/v1/auth/login';
const ana = {
  id: '01a11e1a-99fa-7501-a131-4ad99a122005',
  name: 'Ana',
  email: 'ana@exemplo.com',
  emailVerified: true,
};

describe('LoginPage', () => {
  let env: AuthPageEnv;

  afterEach(() => env.backend.verify());

  async function fillAndSubmit() {
    await type(env, 'E-mail', 'ana@exemplo.com');
    await type(env, 'Senha', 'Correct-Horse-9');
    await submit(env);
  }

  const alertText = () => root(env).querySelector('[role="alert"]')?.textContent?.trim();

  it('validates on the client and focuses the first invalid field without calling the API', async () => {
    env = await openAuthPage('/login');

    await submit(env);

    expect(root(env).textContent).toContain('Informe seu e-mail.');
    expect(root(env).textContent).toContain('Informe sua senha.');
    expect(document.activeElement).toBe(field(env, 'E-mail'));
    env.backend.expectNone(LOGIN);
  });

  it('signs in and goes to the requested internal page', async () => {
    env = await openAuthPage('/login?returnUrl=%2Faccount%2Fsecurity');

    await fillAndSubmit();
    const request = env.backend.expectOne({ method: 'POST', url: LOGIN });
    expect(request.request.body).toEqual({ email: 'ana@exemplo.com', password: 'Correct-Horse-9' });
    request.flush(ana);
    await settle();
    await env.fixture.whenStable();

    expect(env.store.user()).toEqual(ana);
    expect(env.router.url).toBe('/account/security');
  });

  it('ignores an external returnUrl after signing in (no open redirect)', async () => {
    env = await openAuthPage('/login?returnUrl=https%3A%2F%2Fevil.example');

    await fillAndSubmit();
    env.backend.expectOne(LOGIN).flush(ana);
    await settle();
    await env.fixture.whenStable();

    expect(env.router.url).toBe('/');
  });

  it('reports wrong credentials without saying which field, focusing the alert', async () => {
    env = await openAuthPage('/login');

    await fillAndSubmit();
    env.backend.expectOne(LOGIN).flush(problem('INVALID_CREDENTIALS', { status: 401 }), {
      status: 401,
      statusText: 'Unauthorized',
    });
    await settle();
    await env.fixture.whenStable();

    expect(alertText()).toBe('E-mail ou senha incorretos.');
    expect(document.activeElement).toBe(root(env).querySelector('[role="alert"]'));
    expect(field(env, 'Senha').value).toBe('');
    expect(env.store.isAuthenticated()).toBe(false);
    // 401 do login não é sessão vencida: nenhum refresh.
    env.backend.expectNone('/api/v1/auth/refresh');
  });

  it('tells how long to wait when attempts are throttled (BR-018)', async () => {
    env = await openAuthPage('/login');

    await fillAndSubmit();
    env.backend.expectOne(LOGIN).flush(problem('RATE_LIMITED', { status: 429 }), {
      status: 429,
      statusText: 'Too Many Requests',
      headers: new HttpHeaders({ 'Retry-After': '30' }),
    });
    await settle();
    await env.fixture.whenStable();

    expect(alertText()).toBe('Muitas tentativas. Aguarde 30 segundos e tente novamente.');
  });

  it('explains a network failure', async () => {
    env = await openAuthPage('/login');

    await fillAndSubmit();
    env.backend.expectOne(LOGIN).error(new ProgressEvent('error'));
    await settle();
    await env.fixture.whenStable();

    expect(alertText()).toBe(
      'Sem conexão com o servidor. Verifique sua internet e tente novamente.',
    );
  });

  it('toggles password visibility with an accessible pressed state', async () => {
    env = await openAuthPage('/login');
    const toggle = [...root(env).querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Mostrar senha'),
    );

    toggle?.click();
    await env.fixture.whenStable();

    expect(field(env, 'Senha').type).toBe('text');
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(toggle?.textContent?.trim()).toBe('Ocultar senha');
  });
});
