import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { OrganizationRole } from '@taskflow/contracts';
import {
  acme,
  ana,
  MINE,
  nextRequest,
  settle,
  setupOrganizationsTesting,
} from '../../core/organizations/organizations.testing';
import { organizationsRoutes } from './organizations.routes';

const BASE = `/api/v1/organizations/${acme.id}`;
const MEMBERS = `${BASE}/members`;
const INVITATIONS = `${BASE}/invitations`;
const BIA = '0192a000-0000-7000-8000-0000000000b1';
const EVA = '0192a000-0000-7000-8000-0000000000e1';
const JOINED = '2026-10-01T10:00:00.000Z';

const member = (userId: string, name: string, role: OrganizationRole, version = 1) => ({
  userId,
  name,
  email: `${name.toLowerCase()}@exemplo.com`,
  role,
  version,
  joinedAt: JOINED,
});

const invitation = {
  id: '0192a000-0000-7000-8000-0000000000c1',
  email: 'nova@exemplo.com',
  role: 'member' as const,
  status: 'pending' as const,
  invitedBy: { userId: ana.id, name: 'Ana Souza' },
  expiresAt: '2026-10-17T10:00:00.000Z',
  createdAt: '2026-10-10T10:00:00.000Z',
};

const problem = (code: string, status: number) =>
  [
    { type: 'about:blank', title: code, status, code },
    { status, statusText: code },
  ] as const;

async function open(
  myRole: OrganizationRole,
  members = [
    member(ana.id, 'Ana', myRole),
    member(BIA, 'Bia', 'member'),
    member(EVA, 'Eva', 'owner'),
  ],
) {
  const env = setupOrganizationsTesting(organizationsRoutes);
  env.auth.signIn(ana);
  const harness = await RouterTestingHarness.create();
  const navigation = harness.navigateByUrl('/o/acme/members');
  (await nextRequest(env.backend, MINE)).flush({ items: [{ ...acme, role: myRole }] });
  await navigation;
  (await nextRequest(env.backend, MEMBERS)).flush({ items: members, nextCursor: null });
  if (myRole === 'owner' || myRole === 'admin') {
    (await nextRequest(env.backend, INVITATIONS)).flush({ items: [invitation], nextCursor: null });
  }
  await stable(harness);
  return { ...env, harness, router: TestBed.inject(Router) };
}
type Env = Awaited<ReturnType<typeof open>>;

async function stable(harness: RouterTestingHarness) {
  await settle();
  await harness.fixture.whenStable();
}

const root = (env: Env) => env.harness.routeNativeElement as HTMLElement;
const rowOf = (env: Env, name: string) =>
  [...root(env).querySelectorAll('ul[aria-label="Membros da organização"] > li')].find((li) =>
    li.querySelector('p')?.textContent?.includes(name),
  ) as HTMLElement | undefined;
const buttonIn = (scope: Element | undefined, label: string) =>
  [...(scope?.querySelectorAll('button') ?? [])].find(
    (button) => button.textContent?.trim() === label || button.getAttribute('aria-label') === label,
  );
const selectIn = (scope: Element | undefined) => scope?.querySelector('select') ?? null;
const options = (select: HTMLSelectElement | null) =>
  [...(select?.options ?? [])].map((option) => option.value);
const alertText = (env: Env) =>
  root(env).querySelector('[role="alert"]')?.textContent?.trim() ?? '';
const live = (env: Env) =>
  root(env).querySelector('[aria-live="polite"]')?.textContent?.trim() ?? '';

function choose(select: HTMLSelectElement | null, value: string) {
  if (!select) throw new Error('no select');
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

describe('MembersPage (RF-09…RF-12)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('CA-07: the owner changes a role explicitly (select + save) with the version', async () => {
    const env = await open('owner', [
      member(ana.id, 'Ana', 'owner'),
      member(BIA, 'Bia', 'member', 3),
    ]);
    const bia = rowOf(env, 'Bia');
    expect(options(selectIn(bia))).toEqual(['owner', 'admin', 'member', 'viewer']);

    choose(selectIn(bia), 'admin');
    await stable(env.harness);
    buttonIn(bia, 'Salvar papel')?.click();
    const request = await nextRequest(env.backend, `${MEMBERS}/${BIA}`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ role: 'admin', version: 3 });
    request.flush(member(BIA, 'Bia', 'admin', 4));
    await stable(env.harness);

    expect(live(env)).toBe('Bia agora é administrador(a).');
  });

  it('CA-07: an admin cannot promote to owner nor touch owners', async () => {
    const env = await open('admin');

    expect(options(selectIn(rowOf(env, 'Bia')))).toEqual(['admin', 'member', 'viewer']);
    expect(selectIn(rowOf(env, 'Eva'))).toBeNull();
    expect(buttonIn(rowOf(env, 'Eva'), 'Remover Eva')).toBeUndefined();
    expect(buttonIn(rowOf(env, 'Bia'), 'Remover Bia')).toBeDefined();
  });

  it('members and viewers only see the list: no role controls, removals or invitations', async () => {
    const env = await open('member');

    expect(root(env).querySelectorAll('select')).toHaveLength(0);
    expect(buttonIn(rowOf(env, 'Bia'), 'Remover Bia')).toBeUndefined();
    expect(root(env).textContent).not.toContain('Convites');
    expect(buttonIn(rowOf(env, 'Ana'), 'Sair da organização')).toBeDefined();
  });

  it('review #5: stepping down updates the own role in the interface at once', async () => {
    const env = await open('owner', [
      member(ana.id, 'Ana', 'owner'),
      member(EVA, 'Eva', 'owner'),
      member(BIA, 'Bia', 'member'),
    ]);
    choose(selectIn(rowOf(env, 'Ana')), 'admin');
    await stable(env.harness);
    buttonIn(rowOf(env, 'Ana'), 'Salvar papel')?.click();
    (await nextRequest(env.backend, `${MEMBERS}/${ana.id}`)).flush(
      member(ana.id, 'Ana', 'admin', 2),
    );
    await stable(env.harness);

    // Agora admin: sem opção owner para os outros e sem remover owners.
    expect(options(selectIn(rowOf(env, 'Bia')))).toEqual(['admin', 'member', 'viewer']);
    expect(buttonIn(rowOf(env, 'Eva'), 'Remover Eva')).toBeUndefined();
  });

  it('CA-08: shows LAST_OWNER in an alert that receives focus', async () => {
    const env = await open('owner', [member(ana.id, 'Ana', 'owner'), member(BIA, 'Bia', 'member')]);
    choose(selectIn(rowOf(env, 'Ana')), 'admin');
    await stable(env.harness);
    buttonIn(rowOf(env, 'Ana'), 'Salvar papel')?.click();
    (await nextRequest(env.backend, `${MEMBERS}/${ana.id}`)).flush(...problem('LAST_OWNER', 409));
    await stable(env.harness);

    expect(alertText(env)).toContain('pelo menos um proprietário');
    expect(document.activeElement?.getAttribute('role')).toBe('alert');
  });

  it('BR-008: a version conflict reloads the list from the server', async () => {
    const env = await open('owner');
    buttonIn(rowOf(env, 'Bia'), 'Remover Bia')?.click();
    await stable(env.harness);
    buttonIn(rowOf(env, 'Bia'), 'Confirmar')?.click();
    (await nextRequest(env.backend, `${MEMBERS}/${BIA}?version=1`)).flush(
      ...problem('VERSION_CONFLICT', 409),
    );
    (await nextRequest(env.backend, MEMBERS)).flush({
      items: [member(ana.id, 'Ana', 'owner'), member(BIA, 'Bia', 'viewer', 2)],
      nextCursor: null,
    });
    await stable(env.harness);

    expect(alertText(env)).toContain('A lista foi atualizada');
    expect(rowOf(env, 'Bia')?.textContent).toContain('Leitor(a)');
  });

  it('RF-11: removes after an explicit confirmation, focused for keyboard users', async () => {
    const env = await open('owner');
    buttonIn(rowOf(env, 'Bia'), 'Remover Bia')?.click();
    await stable(env.harness);

    expect(rowOf(env, 'Bia')?.textContent).toContain('Remover Bia da organização?');
    expect(document.activeElement?.textContent?.trim()).toBe('Confirmar');
    env.backend.expectNone(`${MEMBERS}/${BIA}?version=1`);

    buttonIn(rowOf(env, 'Bia'), 'Confirmar')?.click();
    const request = await nextRequest(env.backend, `${MEMBERS}/${BIA}?version=1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await stable(env.harness);

    expect(rowOf(env, 'Bia')).toBeUndefined();
    expect(live(env)).toBe('Bia foi removido(a) da organização.');
  });

  it('RF-12: leaving asks for confirmation and leads to /organizations', async () => {
    const env = await open('member');
    buttonIn(rowOf(env, 'Ana'), 'Sair da organização')?.click();
    await stable(env.harness);
    buttonIn(rowOf(env, 'Ana'), 'Cancelar')?.click();
    await stable(env.harness);
    buttonIn(rowOf(env, 'Ana'), 'Sair da organização')?.click();
    await stable(env.harness);
    buttonIn(rowOf(env, 'Ana'), 'Confirmar')?.click();
    (await nextRequest(env.backend, `${MEMBERS}/${ana.id}?version=1`)).flush(null, {
      status: 204,
      statusText: 'No Content',
    });
    (await nextRequest(env.backend, MINE)).flush({ items: [] });
    await stable(env.harness);

    expect(env.router.url).toBe('/organizations');
  });
});

describe('InvitationsPanel (RF-06, RF-07)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  const panel = (env: Env) => root(env).querySelector('tf-invitations-panel') as HTMLElement;
  const panelLive = (env: Env) =>
    panel(env).querySelector('[aria-live="polite"]')?.textContent?.trim() ?? '';

  async function invite(env: Env, email: string, role = 'member') {
    const input = panel(env).querySelector('input[type="email"]') as HTMLInputElement;
    input.value = email;
    input.dispatchEvent(new Event('input'));
    choose(panel(env).querySelector('select'), role);
    panel(env).querySelector('form')?.dispatchEvent(new Event('submit'));
    await stable(env.harness);
  }

  it('lists pending invitations with inviter and deadline', async () => {
    const env = await open('admin');

    expect(panel(env).textContent).toContain('nova@exemplo.com');
    expect(panel(env).textContent).toContain('Convidado(a) por Ana Souza');
  });

  it('RF-06: invites and announces it; never offers owner', async () => {
    const env = await open('owner');
    expect(options(panel(env).querySelector('select'))).toEqual(['admin', 'member', 'viewer']);

    await invite(env, 'caio@exemplo.com', 'viewer');
    const request = await nextRequest(env.backend, INVITATIONS);
    expect(request.request.body).toEqual({ email: 'caio@exemplo.com', role: 'viewer' });
    request.flush(
      {
        ...invitation,
        id: '0192a000-0000-7000-8000-0000000000c2',
        email: 'caio@exemplo.com',
        role: 'viewer',
      },
      { status: 201, statusText: 'Created' },
    );
    await stable(env.harness);

    expect(panelLive(env)).toContain('Convite enviado para caio@exemplo.com.');
    expect(panel(env).textContent).toContain('caio@exemplo.com');
  });

  it('review #1: pages invitations and tells a re-invitation (200) from a new one (201)', async () => {
    const env = await open('owner');
    // Convite aberto que não está na página carregada: a API responde 200 (reconvite).
    const second = {
      ...invitation,
      id: '0192a000-0000-7000-8000-0000000000c9',
      email: 'outra@exemplo.com',
    };

    await invite(env, 'outra@exemplo.com', 'admin');
    (await nextRequest(env.backend, INVITATIONS)).flush(
      { ...second, role: 'admin' },
      { status: 200, statusText: 'OK' },
    );
    await stable(env.harness);

    expect(panelLive(env)).toBe('Convite para outra@exemplo.com atualizado e reenviado.');
    expect(panel(env).textContent).toContain('outra@exemplo.com');
  });

  it('review #1: "load more" appends the next page once, even on a double click', async () => {
    const env = setupOrganizationsTesting(organizationsRoutes);
    env.auth.signIn(ana);
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/o/acme/members');
    (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
    await navigation;
    (await nextRequest(env.backend, MEMBERS)).flush({
      items: [member(ana.id, 'Ana', 'owner')],
      nextCursor: null,
    });
    (await nextRequest(env.backend, INVITATIONS)).flush({
      items: [invitation],
      nextCursor: 'cursor-2',
    });
    await stable(harness);
    const scope = harness.routeNativeElement?.querySelector('tf-invitations-panel') ?? undefined;

    buttonIn(scope, 'Carregar mais')?.click();
    buttonIn(scope, 'Carregar mais')?.click();
    const next = env.backend.match(`${INVITATIONS}?cursor=cursor-2`);
    expect(next).toHaveLength(1);
    next[0]?.flush({
      items: [
        { ...invitation, id: '0192a000-0000-7000-8000-0000000000c3', email: 'b@exemplo.com' },
      ],
      nextCursor: null,
    });
    await stable(harness);

    expect(scope?.textContent).toContain('b@exemplo.com');
    expect(buttonIn(scope, 'Carregar mais')).toBeUndefined();
  });

  it.each([
    ['ALREADY_A_MEMBER', 409, 'Esta pessoa já é membro da organização.'],
    ['RATE_LIMITED', 429, 'Muitas tentativas.'],
  ])('CA-12: shows %s', async (code, status, message) => {
    const env = await open('owner');
    await invite(env, 'bia@exemplo.com');
    (await nextRequest(env.backend, INVITATIONS)).flush(...problem(code, status));
    await stable(env.harness);

    expect(panel(env).querySelector('[role="alert"]')?.textContent).toContain(message);
  });

  it('CA-06: resend refreshes the list; revoke needs confirmation', async () => {
    const env = await open('owner');
    buttonIn(panel(env), 'Reenviar convite para nova@exemplo.com')?.click();
    (await nextRequest(env.backend, `${INVITATIONS}/${invitation.id}/resend`)).flush(null, {
      status: 202,
      statusText: 'Accepted',
    });
    (await nextRequest(env.backend, INVITATIONS)).flush({ items: [invitation], nextCursor: null });
    await stable(env.harness);
    expect(panelLive(env)).toContain('O link anterior deixou de valer.');

    buttonIn(panel(env), 'Revogar convite para nova@exemplo.com')?.click();
    await stable(env.harness);
    buttonIn(panel(env), 'Confirmar')?.click();
    const revoke = await nextRequest(env.backend, `${INVITATIONS}/${invitation.id}`);
    expect(revoke.request.method).toBe('DELETE');
    revoke.flush(null, { status: 204, statusText: 'No Content' });
    await stable(env.harness);

    expect(panel(env).textContent).toContain('Nenhum convite pendente.');
  });
});
