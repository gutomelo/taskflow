import { ANNOUNCE_DEBOUNCE_MS } from './password-requirements';
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

const REGISTER = '/api/v1/auth/register';

describe('RegisterPage', () => {
  let env: AuthPageEnv;

  beforeEach(async () => {
    env = await openAuthPage('/register');
  });

  afterEach(() => env.backend.verify());

  const requirement = (rule: string) =>
    root(env).querySelector<HTMLElement>(`[data-rule="${rule}"]`);
  const isMet = (rule: string) => requirement(rule)?.dataset['met'] === 'true';
  const liveRegion = () =>
    root(env).querySelector('[data-testid="password-requirements-live"]')?.textContent?.trim();

  async function fillValidForm(password = 'Correct-Horse-9') {
    await type(env, 'Nome', 'Ana Souza');
    await type(env, 'E-mail', 'ana@exemplo.com');
    await type(env, 'Senha', password);
  }

  it('updates each password requirement as the user types (CA-12)', async () => {
    await type(env, 'Senha', 'abc');
    expect(isMet('lowercase')).toBe(true);
    expect(isMet('uppercase')).toBe(false);
    expect(isMet('min_length')).toBe(false);

    await type(env, 'Senha', 'Abcdefg1!');
    for (const rule of ['min_length', 'uppercase', 'lowercase', 'digit', 'symbol']) {
      expect(isMet(rule)).toBe(true);
    }
  });

  it('states each requirement in text, not only by color', async () => {
    await type(env, 'Senha', 'abc');

    expect(requirement('uppercase')?.textContent).toContain('uma letra maiúscula');
    expect(requirement('uppercase')?.textContent).toContain('pendente');
    expect(requirement('lowercase')?.textContent).toContain('atendido');
  });

  it('announces pending requirements to screen readers once typing pauses (CA-12)', async () => {
    await type(env, 'Senha', 'abcdefgh');
    // Durante a digitação nada é anunciado (evita ler a lista a cada tecla).
    await new Promise((resolve) => setTimeout(resolve, 200));
    await env.fixture.whenStable();
    expect(liveRegion()).toBe('');

    await new Promise((resolve) => setTimeout(resolve, ANNOUNCE_DEBOUNCE_MS));
    await env.fixture.whenStable();
    expect(liveRegion()).toBe(
      'Requisitos pendentes: uma letra maiúscula; um número; um símbolo, como ! ? @ #.',
    );

    await type(env, 'Senha', 'Abcdefg1!');
    await new Promise((resolve) => setTimeout(resolve, ANNOUNCE_DEBOUNCE_MS + 50));
    await env.fixture.whenStable();
    expect(liveRegion()).toBe('Todos os requisitos de senha foram atendidos.');
  });

  it('links the password field to its requirements', () => {
    expect(field(env, 'Senha').getAttribute('aria-describedby')).toContain('password-requirements');
  });

  it('flags a password equal to the e-mail, and re-checks when the e-mail changes', async () => {
    await type(env, 'Senha', 'Ana@Exemplo.com1');
    expect(isMet('same_as_email')).toBe(true);

    await type(env, 'E-mail', 'ana@exemplo.com1');
    expect(isMet('same_as_email')).toBe(false);
  });

  it('blocks submission when the e-mail is changed to match the password', async () => {
    await type(env, 'Nome', 'Ana Souza');
    await type(env, 'Senha', 'Ana@Exemplo.com1');
    await type(env, 'E-mail', 'ana@exemplo.com1');
    await submit(env);

    expect(document.activeElement).toBe(field(env, 'Senha'));
    env.backend.expectNone(REGISTER);
  });

  it('blocks a weak password on the client and focuses the password field', async () => {
    await fillValidForm('fraca');
    await submit(env);

    expect(root(env).textContent).toContain('A senha ainda não atende a todos os requisitos.');
    expect(document.activeElement).toBe(field(env, 'Senha'));
    env.backend.expectNone(REGISTER);
  });

  it('shows the same confirmation for any accepted registration (BR-014)', async () => {
    await fillValidForm();
    await submit(env);

    const request = env.backend.expectOne({ method: 'POST', url: REGISTER });
    expect(request.request.body).toEqual({
      name: 'Ana Souza',
      email: 'ana@exemplo.com',
      password: 'Correct-Horse-9',
    });
    request.flush(null, { status: 202, statusText: 'Accepted' });
    await settle();
    await env.fixture.whenStable();

    const confirmation = root(env).querySelector('[data-testid="register-success"]');
    expect(root(env).querySelector('h1')?.textContent).toContain('Confira seu e-mail');
    expect(confirmation?.textContent).toContain('ana@exemplo.com');
    expect(document.activeElement).toBe(confirmation);
    expect(root(env).querySelector('form')).toBeNull();
  });

  it('shows rules refused by the server, such as a common password, until it is edited', async () => {
    await fillValidForm('Password1!');
    await submit(env);
    env.backend.expectOne(REGISTER).flush(
      problem('PASSWORD_POLICY_VIOLATION', {
        status: 422,
        violations: [{ field: 'password', message: 'common_password' }],
      }),
      { status: 422, statusText: 'Unprocessable Entity' },
    );
    await settle();
    await env.fixture.whenStable();

    expect(requirement('common_password')?.textContent).toContain('não ser uma senha comum');
    expect(isMet('common_password')).toBe(false);
    expect(root(env).querySelector('[role="alert"]')?.textContent).toContain(
      'A senha ainda não atende a todos os requisitos.',
    );

    await type(env, 'Senha', 'Password1!x');
    expect(requirement('common_password')).toBeNull();
  });

  it('asks to review the fields when the API rejects the data', async () => {
    await fillValidForm();
    await submit(env);
    env.backend.expectOne(REGISTER).flush(problem('VALIDATION_FAILED', { status: 400 }), {
      status: 400,
      statusText: 'Bad Request',
    });
    await settle();
    await env.fixture.whenStable();

    expect(root(env).querySelector('[role="alert"]')?.textContent?.trim()).toBe(
      'Revise os campos destacados.',
    );
  });
});
