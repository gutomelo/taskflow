import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  acme,
  ana,
  MINE,
  nextRequest,
  setupOrganizationsTesting,
} from '../../core/organizations/organizations.testing';
import { organizationsRoutes } from '../organizations/organizations.routes';
import {
  BY_KEY,
  openProjectArea,
  PROJECT,
  PROJECTS,
  problem,
  projectDto,
  stable,
} from './projects.testing';

const workflow = {
  version: 1,
  statuses: [
    {
      id: '0192a000-0000-7000-8000-0000000000a1',
      name: 'A fazer',
      category: 'todo',
      position: 0,
      inUse: false,
    },
    {
      id: '0192a000-0000-7000-8000-0000000000a2',
      name: 'Em andamento',
      category: 'in_progress',
      position: 1,
      inUse: false,
    },
    {
      id: '0192a000-0000-7000-8000-0000000000a3',
      name: 'Concluído',
      category: 'done',
      position: 2,
      inUse: false,
    },
  ],
  transitions: [
    {
      fromStatusId: '0192a000-0000-7000-8000-0000000000a1',
      toStatusId: '0192a000-0000-7000-8000-0000000000a2',
    },
    {
      fromStatusId: '0192a000-0000-7000-8000-0000000000a2',
      toStatusId: '0192a000-0000-7000-8000-0000000000a3',
    },
  ],
};

describe('project area (RF-09, RF-11)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('CA-10: loads the project by key and shows name, key, role and the read-only workflow', async () => {
    const project = projectDto();
    const env = await openProjectArea('', project);

    (await nextRequest(env.backend, `${PROJECT(project)}/workflow`)).flush(workflow);
    await stable(env.harness);

    const text = env.root().textContent ?? '';
    expect(env.root().querySelector('h1')?.textContent).toContain('Website');
    expect(text).toContain('Site institucional');
    expect(text).toContain('Gerente');
    expect(text).toContain('A fazer → Em andamento');
    expect(env.root().querySelector('nav[aria-label="Seções do projeto"]')).not.toBeNull();
  });

  it('BR-026: an archived project shows its state', async () => {
    const env = await openProjectArea(
      '',
      projectDto({ archivedAt: '2026-10-13T12:00:00.000Z', capabilities: ['project:read'] }),
    );
    (await nextRequest(env.backend, `${PROJECTS}/${projectDto().id}/workflow`)).flush(workflow);
    await stable(env.harness);

    expect(env.root().textContent).toContain('Este projeto está arquivado');
  });

  it('a project without access (404) leads back to the list with a notice', async () => {
    const env = setupOrganizationsTesting(organizationsRoutes);
    env.auth.signIn(ana);
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/o/acme/projects/APP');
    (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
    await navigation;
    (await nextRequest(env.backend, BY_KEY('APP'))).flush(...problem('PROJECT_NOT_FOUND', 404));
    await stable(harness);
    (await nextRequest(env.backend, `${PROJECTS}?status=active`)).flush({
      items: [],
      nextCursor: null,
    });
    await stable(harness);

    expect(TestBed.inject(Router).url).toBe('/o/acme/projects');
    expect(harness.routeNativeElement?.textContent).toContain(
      'Projeto não encontrado ou você não tem mais acesso',
    );
  });

  it('shows an error with retry when loading fails for another reason', async () => {
    const env = setupOrganizationsTesting(organizationsRoutes);
    env.auth.signIn(ana);
    const harness = await RouterTestingHarness.create();
    const navigation = harness.navigateByUrl('/o/acme/projects/WEB');
    (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
    await navigation;
    (await nextRequest(env.backend, BY_KEY('WEB'))).flush(...problem('INTERNAL_ERROR', 500));
    await stable(harness);
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      'Não foi possível carregar o projeto.',
    );

    [...root.querySelectorAll('button')]
      .find((button) => button.textContent?.trim() === 'Tentar de novo')
      ?.click();
    (await nextRequest(env.backend, BY_KEY('WEB'))).flush(projectDto());
    await stable(harness);
    expect(root.querySelector('h1')?.textContent).toContain('Website');
  });
});
