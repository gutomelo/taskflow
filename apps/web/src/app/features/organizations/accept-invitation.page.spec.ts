import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MyOrganizationsStore } from '../../core/organizations';
import {
  acme,
  ana,
  MINE,
  nextRequest,
  settle,
  setupOrganizationsTesting,
} from '../../core/organizations/organizations.testing';
import { organizationsRoutes } from './organizations.routes';
import { PendingInvitation } from './pending-invitation';

@Component({ template: 'login' })
class LoginStub {}

const TOKEN = 'abcDEF123_-abcDEF123_-abcDEF123_-abcDEF12';
const LOOKUP = '/api/v1/invitations/lookup';
const ACCEPT = '/api/v1/invitations/accept';
const preview = {
  organizationName: 'Acme',
  role: 'admin' as const,
  invitedByName: 'Eva',
  maskedEmail: 'a***@exemplo.com',
  isForCurrentUser: true,
  expiresAt: '2026-10-17T10:00:00.000Z',
};
const problem = (code: string, status: number) =>
  [
    { type: 'about:blank', title: code, status, code },
    { status, statusText: code },
  ] as const;

async function open(options: { user?: typeof ana | null; withToken?: boolean } = {}) {
  const env = setupOrganizationsTesting([
    ...organizationsRoutes,
    { path: 'login', component: LoginStub },
  ]);
  const user = options.user === undefined ? ana : options.user;
  if (user) env.auth.signIn(user);
  else env.auth.endSession();
  // O link do e-mail é lido do `window.location` (o Router do teste usa localização simulada).
  history.replaceState(
    null,
    '',
    options.withToken === false ? '/invitations/accept' : `/invitations/accept#token=${TOKEN}`,
  );
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl('/invitations/accept');
  await settle();
  return { ...env, harness, router: TestBed.inject(Router) };
}
type Env = Awaited<ReturnType<typeof open>>;

async function stable(env: Env) {
  await settle();
  await env.harness.fixture.whenStable();
}
const root = (env: Env) => env.harness.routeNativeElement as HTMLElement;
const state = (env: Env) =>
  root(env).querySelector('[data-testid="accept-state"]')?.getAttribute('data-state');
const text = (env: Env) => (root(env).textContent ?? '').replace(/\s+/g, ' ');
const button = (env: Env, label: string) =>
  [...root(env).querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );

describe('AcceptInvitationPage (RF-08, BR-020)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('takes the token out of the address bar and never writes it to Web Storage', async () => {
    const env = await open({ user: null });

    expect(location.hash).toBe('');
    expect(TestBed.inject(PendingInvitation).current()).toBe(TOKEN);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain(TOKEN);
    expect(state(env)).toBe('needs_login');
    const links = [...root(env).querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(links).toEqual([
      '/login?returnUrl=%2Finvitations%2Faccept',
      '/register?returnUrl=%2Finvitations%2Faccept',
    ]);
    env.backend.expectNone(LOOKUP);
  });

  it('CA-04: previews, accepts only on click, and opens the organization', async () => {
    const env = await open();
    const lookup = await nextRequest(env.backend, LOOKUP);
    expect(lookup.request.body).toEqual({ token: TOKEN });
    lookup.flush(preview);
    await stable(env);

    expect(state(env)).toBe('ready');
    expect(text(env)).toContain(
      '“Eva” convidou você para a organização “Acme”, com o papel de administrador(a).',
    );
    env.backend.expectNone(ACCEPT);

    button(env, 'Aceitar convite')?.click();
    const accept = await nextRequest(env.backend, ACCEPT);
    expect(accept.request.body).toEqual({ token: TOKEN });
    accept.flush({ ...acme, role: 'admin' });
    // A área da organização busca "minhas organizações" no servidor (a lista não estava carregada).
    (await nextRequest(env.backend, MINE)).flush({ items: [{ ...acme, role: 'admin' }] });
    await stable(env);

    expect(env.router.url).toBe('/o/acme');
    expect(TestBed.inject(MyOrganizationsStore).items()).toEqual([{ ...acme, role: 'admin' }]);
    expect(TestBed.inject(PendingInvitation).current()).toBeNull();
  });

  it('CA-05: another account sees the masked address and no accept button', async () => {
    const env = await open();
    (await nextRequest(env.backend, LOOKUP)).flush({ ...preview, isForCurrentUser: false });
    await stable(env);

    expect(state(env)).toBe('wrong_account');
    expect(text(env)).toContain('Este convite é para a***@exemplo.com.');
    expect(button(env, 'Aceitar convite')).toBeUndefined();
  });

  it('CA-05: a used, revoked or expired invitation is reported and forgotten', async () => {
    const env = await open();
    (await nextRequest(env.backend, LOOKUP)).flush(
      ...problem('INVALID_OR_EXPIRED_INVITATION', 400),
    );
    await stable(env);

    expect(state(env)).toBe('invalid');
    expect(TestBed.inject(PendingInvitation).current()).toBeNull();
  });

  it('BR-013: an unverified account is asked to confirm the e-mail and can come back', async () => {
    const env = await open({ user: { ...ana, emailVerified: false } });
    (await nextRequest(env.backend, LOOKUP)).flush(preview);
    await stable(env);
    expect(state(env)).toBe('needs_verification');

    button(env, 'Já confirmei meu e-mail')?.click();
    (await nextRequest(env.backend, '/api/v1/me')).flush({ ...ana, emailVerified: true });
    (await nextRequest(env.backend, LOOKUP)).flush(preview);
    await stable(env);

    expect(state(env)).toBe('ready');
  });

  it.each([
    ['INVITATION_FOR_ANOTHER_ACCOUNT', 403, 'wrong_account', TOKEN],
    ['ALREADY_A_MEMBER', 409, 'already_member', null],
    ['EMAIL_NOT_VERIFIED', 403, 'needs_verification', TOKEN],
  ])('maps %s on accept', async (code, status, expected, kept) => {
    const env = await open();
    (await nextRequest(env.backend, LOOKUP)).flush(preview);
    await stable(env);
    button(env, 'Aceitar convite')?.click();
    (await nextRequest(env.backend, ACCEPT)).flush(...problem(code, status));
    await stable(env);

    expect(state(env)).toBe(expected);
    expect(TestBed.inject(PendingInvitation).current()).toBe(kept);
  });

  it('keeps the token in memory across the sign-in inside the SPA', async () => {
    const env = await open({ user: null });
    env.auth.signIn(ana);
    await env.harness.navigateByUrl('/login');
    await env.harness.navigateByUrl('/invitations/accept');
    (await nextRequest(env.backend, LOOKUP)).flush(preview);
    await stable(env);

    expect(state(env)).toBe('ready');
  });

  it('guides to reopen the link when the tab lost the token (reload)', async () => {
    const env = await open({ withToken: false });

    expect(state(env)).toBe('no_token');
    expect(text(env)).toContain('abra o link de novo: ele vale por 7 dias');
  });

  it('a network failure in the preview keeps the token and offers a retry', async () => {
    const env = await open();
    (await nextRequest(env.backend, LOOKUP)).flush(null, {
      status: 0,
      statusText: 'Unknown Error',
    });
    await stable(env);
    expect(state(env)).toBe('lookup_failed');

    button(env, 'Tentar de novo')?.click();
    (await nextRequest(env.backend, LOOKUP)).flush(preview);
    await stable(env);

    expect(state(env)).toBe('ready');
  });
});
