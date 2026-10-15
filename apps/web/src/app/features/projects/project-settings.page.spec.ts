import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { nextRequest } from '../../core/organizations/organizations.testing';
import {
  BY_KEY,
  buttonIn,
  openProjectArea,
  PROJECT,
  problem,
  projectDto,
  stable,
} from './projects.testing';

type Env = Awaited<ReturnType<typeof openProjectArea>>;
const field = (env: Env, name: string) =>
  env.root().querySelector<HTMLInputElement | HTMLTextAreaElement>(`[formcontrolname="${name}"]`);

describe('ProjectSettingsPage (RF-04, RF-05, BR-008, BR-026)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('CA-05: the manager edits name and description with the version', async () => {
    const project = projectDto({ version: 3 });
    const env = await openProjectArea('/settings', project);
    const description = field(env, 'description');
    if (!description) throw new Error('no description field');
    description.value = '';
    description.dispatchEvent(new Event('input'));

    env.root().querySelector('form')?.dispatchEvent(new Event('submit'));
    const request = await nextRequest(env.backend, PROJECT(project));
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ name: 'Website', description: null, version: 3 });
    request.flush(projectDto({ version: 4, description: null }));
    await stable(env.harness);

    expect(env.root().textContent).toContain('Alterações salvas.');
  });

  it('without project:update the form is read-only and there is no archive action', async () => {
    const env = await openProjectArea(
      '/settings',
      projectDto({ myRole: 'member', capabilities: ['project:read'] }),
    );

    expect(field(env, 'name')?.disabled).toBe(true);
    expect(buttonIn(env.root(), 'Salvar')).toBeUndefined();
    expect(buttonIn(env.root(), 'Arquivar')).toBeUndefined();
    expect(env.root().textContent).toContain('Só gerentes do projeto alteram as configurações.');
  });

  it('BR-026: archives after confirmation, then offers to restore', async () => {
    const project = projectDto({ version: 2 });
    const env = await openProjectArea('/settings', project);

    buttonIn(env.root(), 'Arquivar')?.click();
    await stable(env.harness);
    // A confirmação recebe o foco (teclado e leitor de tela).
    expect(document.activeElement?.textContent?.trim()).toBe('Confirmar');
    buttonIn(env.root(), 'Confirmar')?.click();
    const request = await nextRequest(env.backend, `${PROJECT(project)}/archive`);
    expect(request.request.body).toEqual({ version: 2 });
    request.flush(
      projectDto({
        version: 3,
        archivedAt: '2026-10-13T12:00:00.000Z',
        capabilities: ['project:read', 'project:archive'],
      }),
    );
    await stable(env.harness);

    expect(env.root().textContent).toContain('Projeto arquivado.');
    expect(field(env, 'name')?.disabled).toBe(true);
    expect(buttonIn(env.root(), 'Restaurar')).toBeDefined();
  });

  it('BR-008: a version conflict reloads the project without leaving the page and explains', async () => {
    const project = projectDto({ version: 1 });
    const env = await openProjectArea('/settings', project);

    env.root().querySelector('form')?.dispatchEvent(new Event('submit'));
    (await nextRequest(env.backend, PROJECT(project))).flush(...problem('VERSION_CONFLICT', 409));
    (await nextRequest(env.backend, BY_KEY(project.key))).flush(
      projectDto({ version: 5, name: 'Portal' }),
    );
    await stable(env.harness);

    expect(env.root().querySelector('[role="alert"]')?.textContent).toContain(
      'alterado por outra pessoa',
    );
    expect(field(env, 'name')?.value).toBe('Portal');
  });
});
