import {
  button,
  field,
  flushed,
  openAuthPage,
  problem,
  root,
  settle,
  submit,
  type,
  type AuthPageEnv,
} from '../auth/auth-pages.testing';

const SESSIONS = '/api/v1/me/sessions';
const PASSWORD = '/api/v1/me/password';
const CSRF = '/api/v1/auth/csrf';
const ana = {
  id: '01a11e1a-99fa-7501-a131-4ad99a122005',
  name: 'Ana',
  email: 'ana@exemplo.com',
  emailVerified: true,
};
const current = {
  id: '01a11e1a-0000-7000-8000-000000000001',
  createdAt: '2026-10-01T10:00:00.000Z',
  lastUsedAt: '2026-10-09T10:00:00.000Z',
  device: { browser: 'Firefox', os: 'Linux' },
  isCurrent: true,
};
const phone = {
  id: '01a11e1a-0000-7000-8000-000000000002',
  createdAt: '2026-09-20T10:00:00.000Z',
  lastUsedAt: '2026-10-09T12:00:00.000Z',
  device: { browser: 'Safari', os: 'iOS' },
  isCurrent: false,
};
const unknown = {
  id: '01a11e1a-0000-7000-8000-000000000003',
  createdAt: '2026-09-01T10:00:00.000Z',
  lastUsedAt: '2026-09-02T10:00:00.000Z',
  device: { browser: null, os: null },
  isCurrent: false,
};

describe('SecurityPage', () => {
  let env: AuthPageEnv;

  async function open(sessions = [phone, unknown, current]) {
    env = await openAuthPage('/account/security', (store) => store.signIn(ana));
    env.backend.expectOne(SESSIONS).flush({ items: sessions });
    await flushed(env);
  }

  afterEach(() => env.backend.verify());

  // O httpResource da lista conta como tarefa pendente: `whenStable` só resolveria depois da
  // resposta. Enquanto houver recarga em andamento, apenas deixamos o ciclo de renderização rodar.
  async function pressThenRespond(target: HTMLButtonElement | null | undefined): Promise<void> {
    target?.click();
    await settle();
  }

  /** Espera a requisição surgir (o resource recarrega numa rodada posterior do agendador). */
  function nextRequest(criteria: string | { method: string; url: string }) {
    return vi.waitFor(() => env.backend.expectOne(criteria), { timeout: 2_000, interval: 10 });
  }

  const sessionRows = () =>
    [...root(env).querySelectorAll<HTMLElement>('[data-testid="sessions-list"] li')].map((row) =>
      row.textContent?.replace(/\s+/g, ' ').trim(),
    );

  it('lists sessions with the current one first and composes device names (i18n-ready)', async () => {
    await open();

    const rows = sessionRows();
    expect(rows[0]).toContain('Firefox no Linux');
    expect(rows[0]).toContain('Esta sessão');
    expect(rows[1]).toContain('Safari no iOS');
    expect(rows[2]).toContain('Navegador desconhecido');
    expect(rows[1]).toMatch(/Último uso em \d{2}\/\d{2}\/\d{4}/);
  });

  it('shows a loading skeleton and then an error with retry when the list fails', async () => {
    env = await openAuthPage('/account/security', (store) => store.signIn(ana));
    expect(root(env).querySelector('[data-testid="sessions-skeleton"]')).not.toBeNull();

    env.backend.expectOne(SESSIONS).flush(problem('INTERNAL_ERROR', { status: 500 }), {
      status: 500,
      statusText: 'Server Error',
    });
    await flushed(env);
    expect(root(env).textContent).toContain('Não foi possível carregar as sessões.');

    await pressThenRespond(button(env, 'Tentar novamente'));
    (await nextRequest(SESSIONS)).flush({ items: [current] });
    await flushed(env);
    expect(sessionRows()).toHaveLength(1);
  });

  it('treats a response outside the contract as a load failure', async () => {
    env = await openAuthPage('/account/security', (store) => store.signIn(ana));
    env.backend.expectOne(SESSIONS).flush({ items: [{ id: 'x' }] });
    await flushed(env);

    expect(root(env).textContent).toContain('Não foi possível carregar as sessões.');
  });

  it('revokes another session and reloads the list (CA-07)', async () => {
    await open();
    const revokeButton = root(env).querySelector<HTMLButtonElement>(
      `[data-session="${phone.id}"] button`,
    );
    expect(revokeButton?.getAttribute('aria-label')).toContain('Safari no iOS');

    await pressThenRespond(revokeButton);
    env.backend.expectOne({ method: 'DELETE', url: `${SESSIONS}/${phone.id}` }).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    (await nextRequest(SESSIONS)).flush({ items: [current, unknown] });
    await flushed(env);

    expect(sessionRows()).toHaveLength(2);
    expect(env.store.isAuthenticated()).toBe(true);
  });

  it('signs out of this browser when the current session is revoked', async () => {
    await open();

    await pressThenRespond(button(env, 'Sair deste dispositivo'));
    env.backend.expectOne({ method: 'DELETE', url: `${SESSIONS}/${current.id}` }).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    // Clear-Site-Data apagou o cookie CSRF: um novo é emitido para o próximo login.
    (await nextRequest(CSRF)).flush(null, { status: 204, statusText: 'No Content' });
    await flushed(env);

    expect(env.store.isAuthenticated()).toBe(false);
    expect(env.router.url).toBe('/login');
  });

  it('reloads silently when the session was already gone', async () => {
    await open();

    await pressThenRespond(
      root(env).querySelector<HTMLButtonElement>(`[data-session="${phone.id}"] button`),
    );
    env.backend
      .expectOne(`${SESSIONS}/${phone.id}`)
      .flush(problem('SESSION_NOT_FOUND', { status: 404 }), {
        status: 404,
        statusText: 'Not Found',
      });
    (await nextRequest(SESSIONS)).flush({ items: [current] });
    await flushed(env);

    expect(root(env).querySelector('[role="alert"]')).toBeNull();
  });

  it('changes the password and reloads the sessions, since the others were revoked (CA-09)', async () => {
    await open();

    await type(env, 'Senha atual', 'Senha-Antiga-1');
    await type(env, 'Nova senha', 'Senha-Nova-2026');
    await submit(env);
    const request = env.backend.expectOne({ method: 'POST', url: PASSWORD });
    expect(request.request.body).toEqual({
      currentPassword: 'Senha-Antiga-1',
      newPassword: 'Senha-Nova-2026',
    });
    request.flush(null, { status: 204, statusText: 'No Content' });
    (await nextRequest(SESSIONS)).flush({ items: [current] });
    await flushed(env);

    const done = root(env).querySelector('[data-testid="password-changed"]');
    expect(done?.textContent).toContain('Senha alterada');
    expect(document.activeElement).toBe(done);
    expect(field(env, 'Senha atual').value).toBe('');
    expect(sessionRows()).toHaveLength(1);
  });

  it('marks the current password field when it is wrong', async () => {
    await open();

    await type(env, 'Senha atual', 'Errada-123!');
    await type(env, 'Nova senha', 'Senha-Nova-2026');
    await submit(env);
    env.backend.expectOne(PASSWORD).flush(problem('CURRENT_PASSWORD_INCORRECT', { status: 403 }), {
      status: 403,
      statusText: 'Forbidden',
    });
    await flushed(env);

    expect(root(env).textContent).toContain('A senha atual está incorreta.');
    expect(document.activeElement).toBe(field(env, 'Senha atual'));
  });

  it("checks the new password against the signed-in user's e-mail", async () => {
    // E-mail com dígito: a senha igual a ele cumpre todas as outras regras (só falha nesta).
    env = await openAuthPage('/account/security', (store) =>
      store.signIn({ ...ana, email: 'ana1@exemplo.com' }),
    );
    env.backend.expectOne(SESSIONS).flush({ items: [current] });
    await flushed(env);

    await type(env, 'Senha atual', 'Senha-Antiga-1');
    await type(env, 'Nova senha', 'Ana1@Exemplo.com');
    expect(
      [...root(env).querySelectorAll('[data-met="false"]')].map((rule) =>
        rule.getAttribute('data-rule'),
      ),
    ).toEqual(['same_as_email']);
    await submit(env);

    expect(root(env).querySelector('[data-rule="same_as_email"]')?.getAttribute('data-met')).toBe(
      'false',
    );
    expect(document.activeElement).toBe(field(env, 'Nova senha'));
    env.backend.expectNone(PASSWORD);
  });
});
