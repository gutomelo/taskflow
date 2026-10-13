import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { ProjectMemberDto, ProjectRole } from '@taskflow/contracts';
import { ana, nextRequest } from '../../core/organizations/organizations.testing';
import {
  BY_KEY,
  buttonIn,
  openProjectArea,
  PROJECT,
  problem,
  projectDto,
  stable,
} from './projects.testing';

const BIA = '0192a000-0000-7000-8000-00000000b1b1';
const CAIO = '0192a000-0000-7000-8000-00000000c1c1';
const VIVI = '0192a000-0000-7000-8000-00000000d1d1';
type Actions = ProjectMemberDto['actions'];
const NONE: Actions = { changeRoleTo: [], remove: false, leave: false };

const member = (
  userId: string,
  name: string,
  role: ProjectRole,
  actions: Actions = NONE,
  version = 1,
): ProjectMemberDto => ({
  userId,
  name,
  email: `${name.toLowerCase()}@exemplo.com`,
  role,
  effectiveRole: role,
  version,
  joinedAt: '2026-10-13T10:00:00.000Z',
  actions,
});

async function open(members: ProjectMemberDto[], project = projectDto()) {
  const env = await openProjectArea('/members', project);
  (await nextRequest(env.backend, `${PROJECT(project)}/members`)).flush({
    items: members,
    nextCursor: null,
  });
  if (project.capabilities.includes('project-member:manage')) {
    (await nextRequest(env.backend, `${PROJECT(project)}/member-candidates`)).flush({
      items: [
        {
          userId: CAIO,
          name: 'Caio',
          email: 'caio@exemplo.com',
          organizationRole: 'member',
          allowedRoles: ['manager', 'member', 'viewer'],
        },
        {
          userId: VIVI,
          name: 'Vivi',
          email: 'vivi@exemplo.com',
          organizationRole: 'viewer',
          allowedRoles: ['viewer'],
        },
      ],
      nextCursor: null,
    });
  }
  await stable(env.harness);
  return { ...env, project };
}
type Env = Awaited<ReturnType<typeof open>>;
const list = (env: Env) => env.root().querySelector('ul[aria-label="Participantes do projeto"]');
const rowOf = (env: Env, name: string) =>
  [...(list(env)?.querySelectorAll('li') ?? [])].find((li) =>
    li.querySelector('p')?.textContent?.includes(name),
  );
const options = (select: HTMLSelectElement | null | undefined) =>
  [...(select?.options ?? [])].map((option) => option.value);

function choose(select: HTMLSelectElement | null | undefined, value: string) {
  if (!select) throw new Error('no select');
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

describe('ProjectMembersPage (RF-06…RF-08)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('CA-07: role options and removal come only from the actions of the API', async () => {
    const env = await open([
      member(ana.id, 'Ana', 'manager', {
        changeRoleTo: ['member', 'viewer'],
        remove: false,
        leave: true,
      }),
      member(BIA, 'Bia', 'member', {
        changeRoleTo: ['manager', 'viewer'],
        remove: true,
        leave: false,
      }),
      member(VIVI, 'Vivi', 'viewer'),
    ]);

    expect(options(rowOf(env, 'Bia')?.querySelector('select'))).toEqual([
      'member',
      'manager',
      'viewer',
    ]);
    expect(buttonIn(rowOf(env, 'Bia'), 'Remover Bia do projeto')).toBeDefined();
    expect(rowOf(env, 'Vivi')?.querySelector('select')).toBeNull();
    expect(buttonIn(rowOf(env, 'Vivi'), 'Remover Vivi do projeto')).toBeUndefined();
    expect(buttonIn(rowOf(env, 'Ana'), 'Sair do projeto')).toBeDefined();
  });

  it('CA-06: adds a candidate with only the roles the ceiling allows', async () => {
    const env = await open([member(ana.id, 'Ana', 'manager')]);
    const [person, role] = [...env.root().querySelectorAll<HTMLSelectElement>('div select')];

    choose(person, VIVI);
    await stable(env.harness);
    expect(options(role)).toEqual(['viewer']);

    buttonIn(env.root(), 'Adicionar')?.click();
    const request = await nextRequest(env.backend, `${PROJECT(env.project)}/members`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ userId: VIVI, role: 'viewer' });
    request.flush(member(VIVI, 'Vivi', 'viewer'));
    await stable(env.harness);

    expect(env.root().textContent).toContain('Vivi agora participa do projeto.');
    expect(rowOf(env, 'Vivi')).toBeDefined();
  });

  it('changes a role with the version and explains API refusals', async () => {
    const env = await open([
      member(
        BIA,
        'Bia',
        'member',
        { changeRoleTo: ['manager', 'viewer'], remove: true, leave: false },
        4,
      ),
    ]);

    choose(rowOf(env, 'Bia')?.querySelector('select'), 'manager');
    await stable(env.harness);
    buttonIn(rowOf(env, 'Bia'), 'Salvar papel')?.click();
    const request = await nextRequest(env.backend, `${PROJECT(env.project)}/members/${BIA}`);
    expect(request.request.body).toEqual({ role: 'manager', version: 4 });
    request.flush(...problem('PROJECT_ROLE_ABOVE_CEILING', 422));
    await stable(env.harness);

    expect(env.root().querySelector('[role="alert"]')?.textContent).toContain(
      'não permite este papel no projeto',
    );
  });

  it('leaving the project goes back to the list', async () => {
    const env = await open(
      [member(ana.id, 'Ana', 'member', { changeRoleTo: [], remove: false, leave: true })],
      projectDto({ myRole: 'member', capabilities: ['project:read'] }),
    );

    buttonIn(rowOf(env, 'Ana'), 'Sair do projeto')?.click();
    await stable(env.harness);
    expect(document.activeElement?.textContent?.trim()).toBe('Confirmar');
    buttonIn(rowOf(env, 'Ana'), 'Confirmar')?.click();
    const request = await nextRequest(
      env.backend,
      `${PROJECT(env.project)}/members/${ana.id}?version=1`,
    );
    expect(request.request.method).toBe('DELETE');
    request.flush(null, { status: 204, statusText: 'No Content' });
    await stable(env.harness);

    expect(TestBed.inject(Router).url).toBe('/o/acme/projects');
  });

  it('BR-026: without project-member:manage (e.g. archived) there is no add section', async () => {
    const env = await open(
      [member(BIA, 'Bia', 'member')],
      projectDto({
        archivedAt: '2026-10-13T12:00:00.000Z',
        capabilities: ['project:read', 'project:archive'],
      }),
    );

    expect(env.root().textContent).not.toContain('Adicionar participante');
  });

  it('after changing their own role, project capabilities and the list come back from the API', async () => {
    const env = await open([
      member(ana.id, 'Ana', 'manager', {
        changeRoleTo: ['member', 'viewer'],
        remove: false,
        leave: true,
      }),
    ]);

    choose(rowOf(env, 'Ana')?.querySelector('select'), 'viewer');
    await stable(env.harness);
    buttonIn(rowOf(env, 'Ana'), 'Salvar papel')?.click();
    (await nextRequest(env.backend, `${PROJECT(env.project)}/members/${ana.id}`)).flush(
      member(ana.id, 'Ana', 'viewer', { changeRoleTo: [], remove: false, leave: true }, 2),
    );
    (await nextRequest(env.backend, BY_KEY(env.project.key))).flush(
      projectDto({ myRole: 'viewer', capabilities: ['project:read'] }),
    );
    (await nextRequest(env.backend, `${PROJECT(env.project)}/members`)).flush({
      items: [member(ana.id, 'Ana', 'viewer', { changeRoleTo: [], remove: false, leave: true }, 2)],
      nextCursor: null,
    });
    await stable(env.harness);

    expect(env.root().textContent).not.toContain('Adicionar participante');
    expect(rowOf(env, 'Ana')?.querySelector('select')).toBeNull();
  });
});
