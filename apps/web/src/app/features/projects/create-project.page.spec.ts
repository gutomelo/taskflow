import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  acme,
  ana,
  MINE,
  nextRequest,
  settle,
  setupOrganizationsTesting,
} from '../../core/organizations/organizations.testing';
import { organizationsRoutes } from '../organizations/organizations.routes';
import { PROJECTS, projectDto } from './projects.testing';

async function open() {
  const env = setupOrganizationsTesting(organizationsRoutes);
  env.auth.signIn(ana);
  const harness = await RouterTestingHarness.create();
  const navigation = harness.navigateByUrl('/o/acme/projects/new');
  (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
  await navigation;
  await settle();
  await harness.fixture.whenStable();
  return { ...env, harness };
}

type Env = Awaited<ReturnType<typeof open>>;
const root = (env: Env) => env.harness.routeNativeElement as HTMLElement;
const input = (env: Env, selector: string) =>
  root(env).querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);

function type(element: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (!element) throw new Error('field not found');
  element.value = value;
  element.dispatchEvent(new Event('input'));
}

async function submit(env: Env) {
  root(env).querySelector('form')?.dispatchEvent(new Event('submit'));
  await settle();
  await env.harness.fixture.whenStable();
}

describe('CreateProjectPage (RF-01, BR-025)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('suggests the key from the name, sends it and opens the new project', async () => {
    const env = await open();
    type(input(env, 'input[formcontrolname="name"]'), 'Portal do Cliente');
    await settle();
    expect(input(env, 'input[formcontrolname="key"]')?.value).toBe('PDC');

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await submit(env);
    const request = await nextRequest(env.backend, PROJECTS);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      name: 'Portal do Cliente',
      key: 'PDC',
      description: null,
    });
    request.flush(projectDto({ key: 'PDC', name: 'Portal do Cliente' }));
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/o', 'acme', 'projects', 'PDC']);
  });

  it('keeps an edited key, typed in uppercase without accents', async () => {
    const env = await open();
    type(input(env, 'input[formcontrolname="key"]'), 'wéb2');
    type(input(env, 'input[formcontrolname="name"]'), 'Outro nome');
    await settle();

    expect(input(env, 'input[formcontrolname="key"]')?.value).toBe('WEB2');
  });

  it('shows PROJECT_KEY_TAKEN on the key field', async () => {
    const env = await open();
    type(input(env, 'input[formcontrolname="name"]'), 'Website');
    await submit(env);
    (await nextRequest(env.backend, PROJECTS)).flush(
      { type: 'about:blank', title: 'x', status: 409, code: 'PROJECT_KEY_TAKEN' },
      { status: 409, statusText: 'Conflict' },
    );
    await settle();
    await env.harness.fixture.whenStable();

    expect(root(env).textContent).toContain('Esta chave já é usada por um projeto da organização');
    expect(document.activeElement?.getAttribute('formcontrolname')).toBe('key');
  });

  it('validates locally before sending (format and required name)', async () => {
    const env = await open();
    type(input(env, 'input[formcontrolname="key"]'), '1');
    await submit(env);

    env.backend.expectNone(PROJECTS);
    expect(root(env).textContent).toContain('Informe o nome do projeto.');
  });

  it('a permission error from the API goes to the alert', async () => {
    const env = await open();
    type(input(env, 'input[formcontrolname="name"]'), 'Website');
    await submit(env);
    (await nextRequest(env.backend, PROJECTS)).flush(
      { type: 'about:blank', title: 'x', status: 403, code: 'INSUFFICIENT_ROLE' },
      { status: 403, statusText: 'Forbidden' },
    );
    await settle();
    await env.harness.fixture.whenStable();

    expect(root(env).querySelector('[role="alert"]')?.textContent).toContain(
      'Seu papel não permite criar projetos',
    );
  });
});
