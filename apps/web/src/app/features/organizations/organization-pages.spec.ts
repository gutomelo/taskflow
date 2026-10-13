import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MyOrganizationsStore } from '../../core/organizations';
import {
  acme,
  ana,
  beta,
  MINE,
  nextRequest,
  settle,
  setupOrganizationsTesting,
} from '../../core/organizations/organizations.testing';
import { organizationsRoutes } from './organizations.routes';

const CREATE = '/api/v1/organizations';

async function open(url: string, user = ana) {
  const env = setupOrganizationsTesting(organizationsRoutes);
  env.auth.signIn(user);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return { ...env, harness, router: TestBed.inject(Router) };
}
type Env = Awaited<ReturnType<typeof open>>;

const root = (env: Env) => env.harness.routeNativeElement as HTMLElement;
const textOf = (env: Env) => (root(env).textContent ?? '').replace(/\s+/g, ' ');

function input(env: Env, label: string): HTMLInputElement {
  const found = [...root(env).querySelectorAll('input')].find(
    (candidate) => candidate.labels?.[0]?.textContent?.trim().replace(/\s*\*$/, '') === label,
  );
  if (!found) throw new Error(`No field labelled "${label}"`);
  return found;
}

async function type(env: Env, label: string, value: string) {
  const field = input(env, label);
  field.value = value;
  field.dispatchEvent(new Event('input'));
  field.dispatchEvent(new Event('blur'));
  await env.harness.fixture.whenStable();
}

async function submit(env: Env) {
  root(env).querySelector('form')?.dispatchEvent(new Event('submit'));
  await env.harness.fixture.whenStable();
}

const problem = (code: string, status: number) => ({
  body: { type: 'about:blank', title: code, status, code },
  init: { status, statusText: code },
});

describe('CreateOrganizationPage (RF-01, CA-01, CA-02)', () => {
  it('suggests the slug from the name until the user edits it', async () => {
    const env = await open('/organizations/new');

    await type(env, 'Nome da organização', 'Café São Paulo');
    expect(input(env, 'Endereço').value).toBe('cafe-sao-paulo');
    expect(textOf(env)).toContain('Seu endereço: /o/cafe-sao-paulo');

    await type(env, 'Endereço', 'cafe-sp');
    await type(env, 'Nome da organização', 'Café São Paulo Ltda');
    expect(input(env, 'Endereço').value).toBe('cafe-sp');
  });

  it('validates on the client before calling the API', async () => {
    const env = await open('/organizations/new');

    await type(env, 'Nome da organização', 'A');
    await type(env, 'Endereço', '1-errado-');
    await submit(env);

    expect(textOf(env)).toContain('Use de 2 a 80 caracteres.');
    expect(textOf(env)).toContain('Use de 3 a 40 letras minúsculas');
    expect(document.activeElement).toBe(input(env, 'Nome da organização'));
    env.backend.expectNone(CREATE);
  });

  it('CA-01: creates, adds it to "my organizations" and opens it', async () => {
    const env = await open('/organizations/new');
    await type(env, 'Nome da organização', 'Acme');
    await submit(env);

    const request = await nextRequest(env.backend, CREATE);
    expect(request.request.body).toEqual({ name: 'Acme', slug: 'acme' });
    request.flush({
      ...acme,
      membersCanCreateProjects: true,
      version: 1,
      createdAt: '2026-10-10T10:00:00.000Z',
      myRole: 'owner',
    });
    // A área da organização busca "minhas organizações" no servidor (a lista não estava carregada).
    (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
    await settle();
    await env.harness.fixture.whenStable();

    expect(env.router.url).toBe('/o/acme');
    expect(TestBed.inject(MyOrganizationsStore).items()).toEqual([acme]);
  });

  it.each([
    ['SLUG_TAKEN', 409, 'Endereço', 'Este endereço já está em uso. Escolha outro.'],
    ['INVALID_SLUG', 400, 'Endereço', 'Alguns nomes são reservados'],
    ['INVALID_ORGANIZATION_NAME', 400, 'Nome da organização', 'Nome inválido'],
  ])('CA-02: shows %s on the field and focuses it', async (code, status, label, message) => {
    const env = await open('/organizations/new');
    await type(env, 'Nome da organização', 'Suporte');
    await submit(env);

    const { body, init } = problem(code, status);
    (await nextRequest(env.backend, CREATE)).flush(body, init);
    await settle();
    await env.harness.fixture.whenStable();

    expect(textOf(env)).toContain(message);
    expect(document.activeElement).toBe(input(env, label));
  });

  it.each([
    ['EMAIL_NOT_VERIFIED', 403, 'Confirme seu e-mail para criar uma organização.'],
    ['ORGANIZATION_LIMIT_REACHED', 422, 'Você atingiu o limite de organizações.'],
    ['RATE_LIMITED', 429, 'Muitas tentativas.'],
  ])('CA-01 / CA-12: announces %s in an alert', async (code, status, message) => {
    const env = await open('/organizations/new');
    await type(env, 'Nome da organização', 'Acme');
    await submit(env);

    const { body, init } = problem(code, status);
    (await nextRequest(env.backend, CREATE)).flush(body, init);
    await settle();
    await env.harness.fixture.whenStable();

    expect(root(env).querySelector('[role="alert"]')?.textContent).toContain(message);
  });

  it('BR-013: warns unverified users before they try', async () => {
    const env = await open('/organizations/new', { ...ana, emailVerified: false });

    expect(root(env).querySelector('[data-testid="unverified-notice"]')).not.toBeNull();
  });
});

describe('OrganizationsPage (RF-02)', () => {
  it('lists the organizations with the role and links to each one', async () => {
    const env = await open('/organizations');
    (await nextRequest(env.backend, MINE)).flush({ items: [acme, beta] });
    await settle();
    await env.harness.fixture.whenStable();

    const links = [...root(env).querySelectorAll('ul a')];
    expect(
      links.map((link) =>
        [...link.querySelectorAll('span')].map((span) => span.textContent?.trim()),
      ),
    ).toEqual([
      ['Acme', 'Proprietário(a)'],
      ['Beta', 'Leitor(a)'],
    ]);
    expect(links[1]?.getAttribute('href')).toBe('/o/beta');
  });

  it('explains how to join when there is none, and retries a failed load', async () => {
    const env = await open('/organizations');
    (await nextRequest(env.backend, MINE)).flush(null, { status: 503, statusText: 'Unavailable' });
    await settle();
    await env.harness.fixture.whenStable();
    expect(textOf(env)).toContain('Não foi possível carregar suas organizações.');

    [...root(env).querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Tentar de novo'))
      ?.click();
    (await nextRequest(env.backend, MINE)).flush({ items: [] });
    await settle();
    await env.harness.fixture.whenStable();

    expect(textOf(env)).toContain('Você ainda não participa de nenhuma organização.');
    expect(textOf(env)).toContain('Recebeu um convite?');
  });
});
