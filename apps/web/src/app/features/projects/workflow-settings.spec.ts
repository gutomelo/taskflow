import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import type { WorkflowDto } from '@taskflow/contracts';
import { nextRequest } from '../../core/organizations/organizations.testing';
import {
  buttonIn,
  openProjectArea,
  PROJECT,
  problem,
  projectDto,
  stable,
} from './projects.testing';

const id = (suffix: string) => `0192a000-0000-7000-8000-0000000005${suffix}`;
const [TODO, DOING, REVIEW, DONE] = [id('01'), id('02'), id('03'), id('04')];
const project = projectDto({
  capabilities: [
    'project:read',
    'project:update',
    'project:archive',
    'project-member:manage',
    'board:configure',
  ],
});

function workflow(overrides: Partial<WorkflowDto> = {}): WorkflowDto {
  return {
    version: 3,
    statuses: [
      { id: TODO, name: 'A fazer', category: 'todo', position: 0, inUse: true },
      { id: DOING, name: 'Em andamento', category: 'in_progress', position: 1, inUse: false },
      { id: REVIEW, name: 'Revisão', category: 'in_progress', position: 2, inUse: true },
      { id: DONE, name: 'Concluído', category: 'done', position: 3, inUse: false },
    ],
    transitions: [{ fromStatusId: TODO, toStatusId: DOING }],
    ...overrides,
  };
}

const WORKFLOW_URL = `${PROJECT(project)}/workflow`;

async function open(value = workflow(), dto = project) {
  const env = await openProjectArea('/settings', dto);
  if (dto.capabilities.includes('board:configure')) {
    (await nextRequest(env.backend, WORKFLOW_URL)).flush(value);
    await stable(env.harness);
  }
  return env;
}

type Env = Awaited<ReturnType<typeof open>>;
const section = (env: Env) =>
  env.root().querySelector('section[aria-labelledby="workflow-settings-title"]');
const row = (env: Env, statusId: string) =>
  section(env)?.querySelector(`[data-status-id="${statusId}"]`);

function type(element: Element | null | undefined, value: string, event = 'input') {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement))
    throw new Error('field');
  element.value = value;
  element.dispatchEvent(new Event(event));
}

describe('WorkflowSettings (spec 005, RF-05 a RF-09)', () => {
  afterEach(() => TestBed.inject(Router).dispose());

  it('lists the statuses in order; category is locked on statuses with tasks', async () => {
    const env = await open();

    const names = [...(section(env)?.querySelectorAll('[data-status-id] input') ?? [])].map(
      (input) => (input as HTMLInputElement).value,
    );
    expect(names).toEqual(['A fazer', 'Em andamento', 'Revisão', 'Concluído']);
    expect(row(env, TODO)?.querySelector('select')?.disabled).toBe(true);
    expect(row(env, DOING)?.querySelector('select')?.disabled).toBe(false);
    expect(row(env, TODO)?.textContent).toContain('Tem tarefas: a categoria não muda.');
  });

  it('creates and renames with the workflow version', async () => {
    const env = await open();
    const form = section(env)?.querySelector('form[aria-label="Novo status"]');
    type(form?.querySelector('input'), 'QA');
    type(form?.querySelector('select'), 'in_progress', 'change');

    buttonIn(form, 'Criar status')?.click();
    const create = await nextRequest(env.backend, `${WORKFLOW_URL}/statuses`);
    expect(create.request.body).toEqual({ name: 'QA', category: 'in_progress', version: 3 });
    create.flush(workflow({ version: 4 }));
    await stable(env.harness);
    expect(section(env)?.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'Fluxo atualizado.',
    );

    type(row(env, DOING)?.querySelector('input'), 'Fazendo');
    buttonIn(row(env, DOING), 'Salvar nome')?.click();
    const rename = await nextRequest(env.backend, `${WORKFLOW_URL}/statuses/${DOING}`);
    expect(rename.request.method).toBe('PATCH');
    expect(rename.request.body).toEqual({ name: 'Fazendo', version: 4 });
  });

  it('moves a status down by swapping it with the next one', async () => {
    const env = await open();

    buttonIn(row(env, DOING), 'Descer Em andamento')?.click();
    const request = await nextRequest(env.backend, `${WORKFLOW_URL}/order`);

    expect(request.request.body).toEqual({ statusIds: [TODO, REVIEW, DOING, DONE], version: 3 });
    expect(
      (buttonIn(row(env, TODO), 'Subir A fazer') as HTMLButtonElement | undefined)?.disabled,
    ).toBe(true);
  });

  it('removing a status with tasks asks for a target of the same category (D2)', async () => {
    const env = await open();

    buttonIn(row(env, REVIEW), 'Remover Revisão')?.click();
    await stable(env.harness);
    const options = [...(row(env, REVIEW)?.querySelectorAll('[role="group"] option') ?? [])].map(
      (option) => option.textContent?.trim(),
    );
    expect(options).toEqual(['', 'Em andamento']);
    type(row(env, REVIEW)?.querySelector('[role="group"] select'), DOING, 'change');
    buttonIn(row(env, REVIEW), 'Confirmar remoção')?.click();
    const request = await nextRequest(
      env.backend,
      `${WORKFLOW_URL}/statuses/${REVIEW}?version=3&moveTasksToStatusId=${DOING}`,
    );

    expect(request.request.method).toBe('DELETE');
  });

  it('the only status of a category with tasks cannot find a target', async () => {
    const env = await open();

    buttonIn(row(env, TODO), 'Remover A fazer')?.click();
    await stable(env.harness);

    expect(row(env, TODO)?.textContent).toContain(
      'Não há outro status desta categoria para receber as tarefas.',
    );
  });

  it('edits the transitions in a labelled matrix and saves the whole set', async () => {
    const env = await open();
    const box = (label: string) =>
      [...(section(env)?.querySelectorAll('fieldset label') ?? [])]
        .find((element) => element.textContent?.trim() === label)
        ?.querySelector('input');

    expect(box('De A fazer para Em andamento')?.checked).toBe(true);
    box('De Em andamento para Concluído')?.click();
    box('De A fazer para Em andamento')?.click();
    buttonIn(section(env), 'Salvar transições')?.click();
    const request = await nextRequest(env.backend, `${WORKFLOW_URL}/transitions`);

    expect(request.request.body).toEqual({
      transitions: [{ fromStatusId: DOING, toStatusId: DONE }],
      version: 3,
    });
  });

  it('a version conflict explains and reloads; an API refusal is shown', async () => {
    const env = await open();

    buttonIn(row(env, DOING), 'Descer Em andamento')?.click();
    (await nextRequest(env.backend, `${WORKFLOW_URL}/order`)).flush(
      ...problem('VERSION_CONFLICT', 409),
    );
    (await nextRequest(env.backend, WORKFLOW_URL)).flush(workflow({ version: 5 }));
    await stable(env.harness);
    expect(section(env)?.querySelector('[role="alert"]')?.textContent).toContain(
      'O fluxo foi alterado por outra pessoa.',
    );

    type(row(env, DOING)?.querySelector('select'), 'done', 'change');
    (await nextRequest(env.backend, `${WORKFLOW_URL}/statuses/${DOING}`)).flush(
      ...problem('WORKFLOW_NEEDS_TODO_STATUS', 422),
    );
    await stable(env.harness);
    expect(section(env)?.querySelector('[role="alert"]')?.textContent).toContain(
      'ao menos um status',
    );
  });

  it('a category refused because the status got tasks meanwhile reloads the workflow', async () => {
    const env = await open();

    type(row(env, DOING)?.querySelector('select'), 'done', 'change');
    (await nextRequest(env.backend, `${WORKFLOW_URL}/statuses/${DOING}`)).flush(
      ...problem('STATUS_IN_USE', 409),
    );
    (await nextRequest(env.backend, WORKFLOW_URL)).flush(workflow({ version: 5 }));
    await stable(env.harness);

    expect(section(env)?.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('CA-09: without board:configure the section is absent', async () => {
    const env = await open(workflow(), projectDto());

    expect(section(env)).toBeNull();
    env.backend.expectNone(WORKFLOW_URL);
  });
});
