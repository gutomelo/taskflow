import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { OrganizationPermission, OrganizationRole } from '@taskflow/contracts';
import {
  acme,
  ana,
  MINE,
  nextRequest,
  settle,
  setupOrganizationsTesting,
} from '../../core/organizations/organizations.testing';
import { organizationsRoutes } from '../organizations/organizations.routes';
import { PROJECTS } from './projects.testing';

const summary = (key: string, name: string, archived = false) => ({
  id: `0192a000-0000-7000-8000-0000000000${key.length}${archived ? 'a' : '0'}`.slice(0, 36),
  key,
  name,
  archived,
  myRole: 'member' as const,
});

async function open(role: OrganizationRole, capabilities: OrganizationPermission[]) {
  const env = setupOrganizationsTesting(organizationsRoutes);
  env.auth.signIn(ana);
  const harness = await RouterTestingHarness.create();
  const navigation = harness.navigateByUrl('/o/acme/projects');
  (await nextRequest(env.backend, MINE)).flush({ items: [{ ...acme, role, capabilities }] });
  await navigation;
  return { ...env, harness };
}

const root = (env: Awaited<ReturnType<typeof open>>) =>
  env.harness.routeNativeElement as HTMLElement;
const settled = async (env: Awaited<ReturnType<typeof open>>) => {
  await settle();
  await env.harness.fixture.whenStable();
};

describe('ProjectsListPage (RF-02, RF-11)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('shows a skeleton, then the active projects as links by key', async () => {
    const env = await open('member', ['organization:read', 'project:create']);
    expect(root(env).textContent).toContain('Carregando projetos…');

    const request = await nextRequest(env.backend, `${PROJECTS}?status=active`);
    request.flush({ items: [summary('WEB', 'Website')], nextCursor: null });
    await settled(env);

    const link = root(env).querySelector<HTMLAnchorElement>('ul[aria-label="Projetos"] a');
    expect(link?.textContent).toContain('Website');
    expect(link?.getAttribute('href')).toBe('/o/acme/projects/WEB');
    expect(root(env).textContent).toContain('Seu papel: membro');
  });

  it('CA-10: "Novo projeto" appears only with the project:create capability from the API', async () => {
    const withCapability = await open('member', ['organization:read', 'project:create']);
    (await nextRequest(withCapability.backend, `${PROJECTS}?status=active`)).flush({
      items: [],
      nextCursor: null,
    });
    await settled(withCapability);
    expect(root(withCapability).querySelector('a[href="/o/acme/projects/new"]')).not.toBeNull();
    TestBed.inject(Router).dispose();
    TestBed.resetTestingModule();

    const without = await open('member', ['organization:read']);
    (await nextRequest(without.backend, `${PROJECTS}?status=active`)).flush({
      items: [],
      nextCursor: null,
    });
    await settled(without);
    expect(root(without).querySelector('a[href="/o/acme/projects/new"]')).toBeNull();
    expect(root(without).textContent).toContain('Nenhum projeto ativo por aqui ainda.');
  });

  it('switches to archived projects and loads more pages, one at a time', async () => {
    const env = await open('owner', acme.capabilities);
    (await nextRequest(env.backend, `${PROJECTS}?status=active`)).flush({
      items: [],
      nextCursor: null,
    });
    await settled(env);
    expect(root(env).textContent).toContain('proprietários e administradores veem todos');

    const archivedButton = [...root(env).querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Arquivados',
    );
    archivedButton?.click();
    (await nextRequest(env.backend, `${PROJECTS}?status=archived`)).flush({
      items: [summary('OLD', 'Antigo', true)],
      nextCursor: 'c1',
    });
    await settled(env);
    expect(archivedButton?.getAttribute('aria-pressed')).toBe('true');
    expect(root(env).textContent).toContain('Arquivado');

    const more = [...root(env).querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Carregar mais',
    );
    more?.click();
    more?.click();
    await settle();
    // `match` remove da fila tudo o que casa: conta as requisições em vez de confiar em `verify`.
    const pages = env.backend.match(`${PROJECTS}?cursor=c1&status=archived`);
    expect(pages).toHaveLength(1);
    pages[0]?.flush({ items: [summary('VELHO', 'Velho', true)], nextCursor: null });
    await settled(env);
    expect(root(env).querySelectorAll('ul[aria-label="Projetos"] li')).toHaveLength(2);
  });

  it('shows an error with a retry', async () => {
    const env = await open('member', ['organization:read']);
    (await nextRequest(env.backend, `${PROJECTS}?status=active`)).flush(null, {
      status: 500,
      statusText: 'Erro',
    });
    await settled(env);
    expect(root(env).querySelector('[role="alert"]')?.textContent).toContain(
      'Não foi possível carregar os projetos.',
    );

    [...root(env).querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Tentar de novo')
      ?.click();
    (await nextRequest(env.backend, `${PROJECTS}?status=active`)).flush({
      items: [summary('WEB', 'Website')],
      nextCursor: null,
    });
    await settled(env);
    expect(root(env).textContent).toContain('Website');
  });
});
