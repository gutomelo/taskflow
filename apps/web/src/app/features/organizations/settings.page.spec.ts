import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { OrganizationRole } from '@taskflow/contracts';
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

const URL = `/api/v1/organizations/${acme.id}`;
const dto = (name: string, version: number, myRole: OrganizationRole = 'owner') => ({
  id: acme.id,
  name,
  slug: 'acme',
  version,
  createdAt: '2026-10-01T10:00:00.000Z',
  myRole,
});

async function open(role: OrganizationRole) {
  const env = setupOrganizationsTesting(organizationsRoutes);
  env.auth.signIn(ana);
  const harness = await RouterTestingHarness.create();
  const navigation = harness.navigateByUrl('/o/acme/settings');
  (await nextRequest(env.backend, MINE)).flush({ items: [{ ...acme, role }] });
  await navigation;
  (await nextRequest(env.backend, URL)).flush(dto('Acme', 3, role));
  await settle();
  await harness.fixture.whenStable();
  return { ...env, harness };
}

const root = (env: Awaited<ReturnType<typeof open>>) =>
  env.harness.routeNativeElement as HTMLElement;

async function rename(env: Awaited<ReturnType<typeof open>>, name: string) {
  const input = root(env).querySelector('input') as HTMLInputElement;
  input.value = name;
  input.dispatchEvent(new Event('input'));
  root(env).querySelector('form')?.dispatchEvent(new Event('submit'));
  await env.harness.fixture.whenStable();
}

describe('SettingsPage (RF-05, BR-008, BR-022)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('renames with the loaded version and updates "my organizations"; the slug stays fixed', async () => {
    const env = await open('admin');
    expect(root(env).textContent).toContain('/o/acme — o endereço não pode ser alterado.');

    await rename(env, 'Acme Brasil');
    const request = await nextRequest(env.backend, URL);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Acme Brasil', version: 3 });
    request.flush(dto('Acme Brasil', 4, 'admin'));
    await settle();

    expect(TestBed.inject(MyOrganizationsStore).items()[0]?.name).toBe('Acme Brasil');
  });

  it('BR-008: on a version conflict, reloads the current data and explains', async () => {
    const env = await open('owner');
    await rename(env, 'Minha versão');
    (await nextRequest(env.backend, URL)).flush(
      { type: 'about:blank', title: 'x', status: 409, code: 'VERSION_CONFLICT' },
      { status: 409, statusText: 'Conflict' },
    );
    (await nextRequest(env.backend, URL)).flush(dto('Versão de outra pessoa', 4));
    await settle();
    await env.harness.fixture.whenStable();

    expect((root(env).querySelector('input') as HTMLInputElement).value).toBe(
      'Versão de outra pessoa',
    );
    expect(root(env).querySelector('[role="alert"]')?.textContent).toContain(
      'alterada por outra pessoa',
    );
  });

  it('is read-only for members', async () => {
    const env = await open('member');

    expect((root(env).querySelector('input') as HTMLInputElement).readOnly).toBe(true);
    expect(root(env).querySelector('button[type="submit"]')).toBeNull();
    expect(root(env).textContent).toContain('Só proprietários e administradores alteram o nome.');
  });
});
