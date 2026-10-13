import { RouterTestingHarness } from '@angular/router/testing';
import type { ProjectDto, ProjectPermission, ProjectRole } from '@taskflow/contracts';
import {
  acme,
  ana,
  MINE,
  nextRequest,
  settle,
  setupOrganizationsTesting,
} from '../../core/organizations/organizations.testing';
import { organizationsRoutes } from '../organizations/organizations.routes';

export const PROJECTS = `/api/v1/organizations/${acme.id}/projects`;

const MANAGER: ProjectPermission[] = [
  'project:read',
  'project:update',
  'project:archive',
  'project-member:manage',
];
/** Capacidades que a API devolve por papel efetivo (simulação; a regra vive no backend). */
export const PROJECT_CAPABILITIES: Record<ProjectRole, ProjectPermission[]> = {
  manager: MANAGER,
  member: ['project:read', 'task:create'],
  viewer: ['project:read'],
};

/** Projeto como a API devolve. */
export function projectDto(overrides: Partial<ProjectDto> = {}): ProjectDto {
  const myRole = overrides.myRole ?? 'manager';
  return {
    id: '0192a000-0000-7000-8000-0000000000f1',
    key: 'WEB',
    name: 'Website',
    description: 'Site institucional',
    archivedAt: null,
    version: 1,
    createdAt: '2026-10-13T10:00:00.000Z',
    myRole,
    capabilities: PROJECT_CAPABILITIES[myRole],
    ...overrides,
  };
}

export const BY_KEY = (key: string) => `${PROJECTS}/by-key/${key}`;
export const PROJECT = (project: { id: string }) => `${PROJECTS}/${project.id}`;

export const problem = (code: string, status: number) =>
  [
    { type: 'about:blank', title: code, status, code },
    { status, statusText: code },
  ] as const;

/** Abre `path` da área do projeto com a organização `acme` e o projeto devolvido pela API. */
export async function openProjectArea(path: string, project: ProjectDto) {
  const env = setupOrganizationsTesting(organizationsRoutes);
  env.auth.signIn(ana);
  const harness = await RouterTestingHarness.create();
  const navigation = harness.navigateByUrl(`/o/acme/projects/${project.key}${path}`);
  (await nextRequest(env.backend, MINE)).flush({ items: [acme] });
  await navigation;
  (await nextRequest(env.backend, BY_KEY(project.key))).flush(project);
  await stable(harness);
  return { ...env, harness, root: () => harness.routeNativeElement as HTMLElement };
}

export async function stable(harness: RouterTestingHarness) {
  await settle();
  await harness.fixture.whenStable();
}

export const buttonIn = (scope: Element | null | undefined, label: string) =>
  [...(scope?.querySelectorAll('button, a') ?? [])].find(
    (element) =>
      element.textContent?.trim() === label || element.getAttribute('aria-label') === label,
  ) as HTMLElement | undefined;
