import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { OrganizationPermission, OrganizationRole } from '@taskflow/contracts';
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
const CAPABILITIES: Record<OrganizationRole, OrganizationPermission[]> = {
  owner: [
    'organization:read',
    'organization:update',
    'member:invite',
    'member:change-role',
    'member:remove',
    'project:create',
  ],
  admin: [
    'organization:read',
    'organization:update',
    'member:invite',
    'member:change-role',
    'member:remove',
    'project:create',
  ],
  member: ['organization:read', 'project:create'],
  viewer: ['organization:read'],
};

const dto = (
  name: string,
  version: number,
  myRole: OrganizationRole = 'owner',
  membersCanCreateProjects = true,
) => ({
  id: acme.id,
  name,
  slug: 'acme',
  membersCanCreateProjects,
  version,
  createdAt: '2026-10-01T10:00:00.000Z',
  myRole,
  capabilities: CAPABILITIES[myRole],
});

async function open(role: OrganizationRole) {
  const env = setupOrganizationsTesting(organizationsRoutes);
  env.auth.signIn(ana);
  const harness = await RouterTestingHarness.create();
  const navigation = harness.navigateByUrl('/o/acme/settings');
  (await nextRequest(env.backend, MINE)).flush({
    items: [{ ...acme, role, capabilities: CAPABILITIES[role] }],
  });
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
    expect(request.request.body).toEqual({
      name: 'Acme Brasil',
      membersCanCreateProjects: true,
      version: 3,
    });
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
    expect(root(env).textContent).toContain(
      'Só proprietários e administradores alteram as configurações.',
    );
  });

  it('CA-03: owner/admin turn off "members can create projects"; it is saved with the version', async () => {
    const env = await open('admin');
    const checkbox = root(env).querySelector<HTMLInputElement>('#members-can-create-projects');
    expect(checkbox?.checked).toBe(true);
    expect(checkbox?.disabled).toBe(false);
    expect(checkbox?.labels?.[0]?.textContent?.trim()).toBe('Membros podem criar projetos');

    checkbox?.click();
    root(env).querySelector('form')?.dispatchEvent(new Event('submit'));
    const request = await nextRequest(env.backend, URL);
    expect(request.request.body).toEqual({
      name: 'Acme',
      membersCanCreateProjects: false,
      version: 3,
    });
    request.flush(dto('Acme', 4, 'admin', false));
    await settle();
    await env.harness.fixture.whenStable();

    expect(root(env).querySelector<HTMLInputElement>('#members-can-create-projects')?.checked).toBe(
      false,
    );
  });

  it('shows the setting to members without letting them change it', async () => {
    const env = await open('member');

    expect(
      root(env).querySelector<HTMLInputElement>('#members-can-create-projects')?.disabled,
    ).toBe(true);
  });

  it('disables the setting when the capabilities change with the page open', async () => {
    const env = await open('admin');

    TestBed.inject(MyOrganizationsStore).add({
      ...acme,
      role: 'member',
      capabilities: CAPABILITIES.member,
    });
    await settle();
    await env.harness.fixture.whenStable();

    expect(
      root(env).querySelector<HTMLInputElement>('#members-can-create-projects')?.disabled,
    ).toBe(true);
  });
});
