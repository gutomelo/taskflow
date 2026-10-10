import { HttpClient } from '@angular/common/http';
import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { firstValueFrom } from 'rxjs';
import { organizationsRoutes } from '../../features/organizations/organizations.routes';
import { ActiveOrganizationStore } from './active-organization.store';
import { LastOrganizationStorage } from './last-organization';
import { MyOrganizationsStore } from './my-organizations.store';
import {
  acme,
  ana,
  beta,
  MINE,
  nextRequest,
  settle,
  setupOrganizationsTesting,
} from './organizations.testing';
import { tenantUrl } from './organizations-api';

@Component({ template: 'login' })
class LoginStub {}

/** Página filha que expõe o id ativo, para provar que a área é recriada na troca de slug. */
let instances = 0;
@Component({ template: '<p data-testid="active">{{ store.id() }}</p>' })
class ProbePage {
  protected readonly store = inject(ActiveOrganizationStore);
  constructor() {
    instances += 1;
  }
}

async function open(
  url: string,
  prepare: (env: ReturnType<typeof setupOrganizationsTesting>) => void,
) {
  const routes = organizationsRoutes.map((route) =>
    route.path === 'o/:slug'
      ? { ...route, children: [...(route.children ?? []), { path: 'probe', component: ProbePage }] }
      : route,
  );
  const env = setupOrganizationsTesting([...routes, { path: 'login', component: LoginStub }]);
  prepare(env);
  const harness = await RouterTestingHarness.create();
  const navigation = harness.navigateByUrl(url);
  return { ...env, harness, navigation, router: TestBed.inject(Router) };
}

const text = (harness: RouterTestingHarness) =>
  (harness.routeNativeElement?.textContent ?? '').replace(/\s+/g, ' ').trim();
const activeId = (harness: RouterTestingHarness) =>
  harness.routeNativeElement?.querySelector('[data-testid="active"]')?.textContent?.trim();

describe('organization routing (T18)', () => {
  beforeEach(() => {
    instances = 0;
  });

  it('CA-10: "/" opens the last organization of this user', async () => {
    const env = await open('/', ({ auth }) => {
      auth.signIn(ana);
      TestBed.inject(LastOrganizationStorage).write(ana.id, 'beta');
    });
    (await nextRequest(env.backend, MINE)).flush({ items: [acme, beta] });
    await env.navigation;

    expect(env.router.url).toBe('/o/beta');
    expect(text(env.harness)).toContain('Olá, Ana Souza!');
    expect(text(env.harness)).toContain('Você está em “Beta” como leitor(a).');
  });

  it('CA-10: "/" falls back to the first organization, ignoring the last one of another user', async () => {
    const env = await open('/', ({ auth }) => {
      auth.signIn(ana);
      TestBed.inject(LastOrganizationStorage).write('outra-pessoa', 'beta');
    });
    (await nextRequest(env.backend, MINE)).flush({ items: [acme, beta] });
    await env.navigation;

    expect(env.router.url).toBe('/o/acme');
    expect(TestBed.inject(LastOrganizationStorage).read(ana.id)).toBe('acme');
  });

  it('CA-10: "/" leads a user without organizations to the onboarding', async () => {
    const env = await open('/', ({ auth }) => auth.signIn(ana));
    (await nextRequest(env.backend, MINE)).flush({ items: [] });
    await env.navigation;

    expect(env.router.url).toBe('/organizations/new');
  });

  it('sends anonymous visitors to the login', async () => {
    const env = await open('/o/acme', ({ auth }) => auth.endSession());
    await env.navigation;

    expect(env.router.url).toBe('/login?returnUrl=%2Fo%2Facme');
    env.backend.verify();
  });

  it('an unknown slug (or one without membership) lands on /organizations with a notice', async () => {
    const env = await open('/o/gama', ({ auth }) => auth.signIn(ana));
    (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
    await settle();
    (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
    await env.navigation;
    await settle();
    env.backend.match(MINE).forEach((request) => request.flush({ items: [acme] }));
    await env.harness.fixture.whenStable();

    expect(env.router.url).toBe('/organizations');
    expect(text(env.harness)).toContain(
      'Organização não encontrada ou você não tem mais acesso a ela.',
    );
  });

  it('switching organizations recreates the area and its stores (no mixed data)', async () => {
    const env = await open('/o/acme/probe', ({ auth }) => auth.signIn(ana));
    (await nextRequest(env.backend, MINE)).flush({ items: [acme, beta] });
    await env.navigation;
    expect(activeId(env.harness)).toBe(acme.id);

    await env.harness.navigateByUrl('/o/beta/probe');

    expect(activeId(env.harness)).toBe(beta.id);
    expect(instances).toBe(2);
  });

  it('CA-09: a tenant 404 invalidates the list and leads to /organizations', async () => {
    const env = await open('/o/acme/probe', ({ auth }) => auth.signIn(ana));
    (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
    await env.navigation;

    const call = firstValueFrom(TestBed.inject(HttpClient).get(tenantUrl(acme.id, '/members')));
    env.backend
      .expectOne(tenantUrl(acme.id, '/members'))
      .flush(
        { type: 'about:blank', title: 'x', status: 404, code: 'ORGANIZATION_NOT_FOUND' },
        { status: 404, statusText: 'Not Found' },
      );
    await expect(call).rejects.toBeTruthy();
    // `/organizations` busca a lista de novo: a organização já não está nela.
    (await nextRequest(env.backend, MINE)).flush({ items: [] });
    await settle();
    await env.harness.fixture.whenStable();

    expect(env.router.url).toBe('/organizations');
    expect(TestBed.inject(MyOrganizationsStore).items()).toEqual([]);
  });

  it('ignores 404s of other kinds (e.g. a missing member)', async () => {
    const env = await open('/o/acme/probe', ({ auth }) => auth.signIn(ana));
    (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
    await env.navigation;

    const call = firstValueFrom(TestBed.inject(HttpClient).get(tenantUrl(acme.id, '/members/x')));
    env.backend
      .expectOne(tenantUrl(acme.id, '/members/x'))
      .flush(
        { type: 'about:blank', title: 'x', status: 404, code: 'MEMBER_NOT_FOUND' },
        { status: 404, statusText: 'Not Found' },
      );
    await expect(call).rejects.toBeTruthy();
    await settle();

    expect(env.router.url).toBe('/o/acme/probe');
  });

  it('signing out clears the remembered organization and the in-memory list', async () => {
    const env = await open('/o/acme/probe', ({ auth }) => auth.signIn(ana));
    (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
    await env.navigation;
    expect(TestBed.inject(LastOrganizationStorage).read(ana.id)).toBe('acme');

    env.auth.endSession();
    TestBed.tick();

    expect(TestBed.inject(LastOrganizationStorage).read(ana.id)).toBeNull();
    expect(TestBed.inject(MyOrganizationsStore).items()).toEqual([]);
  });
});
