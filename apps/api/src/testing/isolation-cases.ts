import type { Response } from 'supertest';
import { z } from 'zod';
import {
  addProjectMemberRequestSchema,
  changeMemberRoleRequestSchema,
  changeProjectMemberRoleRequestSchema,
  createProjectRequestSchema,
  inviteMemberRequestSchema,
  pageQuerySchema,
  projectListQuerySchema,
  projectVersionRequestSchema,
  removeMemberQuerySchema,
  removeProjectMemberQuerySchema,
  updateOrganizationRequestSchema,
  updateProjectRequestSchema,
  addDependencyRequestSchema,
  assignableUsersQuerySchema,
  assignTaskRequestSchema,
  createTaskRequestSchema,
  deleteTaskQuerySchema,
  taskListQuerySchema,
  taskVersionRequestSchema,
  transitionTaskRequestSchema,
  updateTaskRequestSchema,
  boardQuerySchema,
  columnQuerySchema,
  createStatusRequestSchema,
  moveCardRequestSchema,
  removeStatusQuerySchema,
  reorderStatusesRequestSchema,
  replaceTransitionsRequestSchema,
  updateStatusRequestSchema,
  commentListQuerySchema,
  createCommentRequestSchema,
  editCommentRequestSchema,
  mentionCandidatesQuerySchema,
} from '@taskflow/contracts';
import type { InputSchema, IsolationExpectation, RouteKey } from './tenant-isolation';

/** Cliente HTTP autenticado (sessão + CSRF) usado nos casos. */
export interface TestClient {
  get(path: string): Promise<Response>;
  post(path: string, body?: object): Promise<Response>;
  patch(path: string, body?: object): Promise<Response>;
  put(path: string, body?: object): Promise<Response>;
  delete(path: string): Promise<Response>;
}

/**
 * Duas organizações semeadas, cada uma com projeto, participantes e workflow (spec 003). Dois
 * atores sob o prefixo de A:
 * - **owner de A** (papel de maior privilégio, papel efetivo `manager` em tudo);
 * - **membro de A e de B** (`member` nos dois, manager do projeto de A e participante de um
 *   projeto de B): exercita o caminho de visibilidade por participação — uma consulta que
 *   esqueça `organizationId` aparece com ele, não com o owner.
 */
export interface IsolationWorld {
  readonly orgA: string;
  readonly orgB: string;
  /** Recursos reais de A, para trocar **uma** referência por vez (as demais continuam válidas). */
  readonly ofA: Readonly<{
    projectId: string;
    key: string;
    participantUserId: string;
    /** Tarefa de A (versão 1, status inicial), para trocar só a outra referência. */
    taskId: string;
    /** Status do workflow de A, na ordem (versão do workflow 1). */
    statusIds: ReadonlyArray<string>;
    /** Comentário de A (do membro duplo, versão 1), na tarefa de A (spec 010). */
    commentId: string;
  }>;
  /** Ids, chaves e cursores reais de B, por nome de referência. */
  readonly ofB: Readonly<Record<string, string>>;
  readonly asOwnerOfA: TestClient;
  readonly asDualMember: TestClient;
  /** Pertence às duas organizações: aparece legitimamente nas respostas de A (fora dos canários). */
  readonly dualMemberUserId: string;
}

export type IsolationVariant = Readonly<{
  expect: IsolationExpectation;
  /** Código do Problem Details esperado em `not-found` (prova que a referência trocada foi a barrada). */
  code?: string;
  /** Status de `refused` (padrão 422). */
  status?: number;
  /**
   * Quem executa: só o owner de A (rotas que exigem papel de organização), só o membro de A e B
   * (autor de recurso de A, spec 010) ou os dois atores.
   */
  actors: 'owner-of-A' | 'dual-member' | 'both';
  call: (world: IsolationWorld, actor: TestClient) => Promise<Response>;
}>;

export type IsolationCase = Readonly<{
  /** Schema do corpo (`null` = sem corpo). Obrigatório: esquecer não compila (obrigação 6 da 006). */
  body: InputSchema | null;
  /** Schema da query (`null` = sem query). */
  query: InputSchema | null;
  references: Readonly<Record<string, IsolationVariant>>;
}>;

const notFound = (
  code: string,
  call: IsolationVariant['call'],
  actors: IsolationVariant['actors'] = 'both',
): IsolationVariant => ({ expect: 'not-found', code, actors, call });
const noLeak = (
  call: IsolationVariant['call'],
  actors: IsolationVariant['actors'] = 'both',
): IsolationVariant => ({ expect: 'no-leak', actors, call });

const refused = (code: string, call: IsolationVariant['call'], status = 422): IsolationVariant => ({
  expect: 'refused',
  code,
  status,
  actors: 'both',
  call,
});

/** POST sem corpo (ações): declara um objeto vazio, nunca omite. */
const emptyBody = z.strictObject({});

const org = (world: IsolationWorld) => `/organizations/${world.orgA}`;
const projectOfA = (world: IsolationWorld) => `${org(world)}/projects/${world.ofA.projectId}`;
const projectOfB = (world: IsolationWorld) => `${org(world)}/projects/${world.ofB['projectId']}`;
const tasks = (world: IsolationWorld) => `${org(world)}/tasks`;
const taskOfA = (world: IsolationWorld) => `${tasks(world)}/${world.ofA.taskId}`;
const taskOfB = (world: IsolationWorld) => `${tasks(world)}/${world.ofB['taskId']}`;

/** Variante "tarefa de B sob o prefixo de A" (404 uniforme, achado M3). */
const foreignTask = (
  suffix: string,
  send: (actor: TestClient, path: string) => Promise<Response> = (actor, path) => actor.get(path),
) => notFound('TASK_NOT_FOUND', (world, actor) => send(actor, `${taskOfB(world)}${suffix}`));

/** Variante "projeto de B sob o prefixo de A" para rotas `/projects/:projectId/...`. */
const foreignProject = (
  suffix: string,
  send: (actor: TestClient, path: string) => Promise<Response> = (actor, path) => actor.get(path),
) => notFound('PROJECT_NOT_FOUND', (world, actor) => send(actor, `${projectOfB(world)}${suffix}`));

/**
 * Casos por rota do escopo do tenant (spec 006, CA-07; spec 003, CA-09). Além destes, o harness
 * gera para **toda** rota a chamada com o prefixo de B (⇒ 404). Cada parâmetro de caminho e cada
 * referência de corpo ou query (derivada do schema declarado) precisa de variante.
 */
export const ISOLATION_CASES: Readonly<Record<RouteKey, IsolationCase>> = {
  // --- organizations (specs 002 e 006) ---
  'GET /organizations/:organizationId': { body: null, query: null, references: {} },
  'PATCH /organizations/:organizationId': {
    body: updateOrganizationRequestSchema,
    query: null,
    references: {},
  },
  'GET /organizations/:organizationId/members': {
    body: null,
    query: pageQuerySchema,
    references: {
      list: noLeak((world, actor) => actor.get(`${org(world)}/members`)),
      cursor: noLeak((world, actor) =>
        actor.get(`${org(world)}/members?cursor=${world.ofB['membersCursor']}`),
      ),
    },
  },
  'PATCH /organizations/:organizationId/members/:userId': {
    body: changeMemberRoleRequestSchema,
    query: null,
    references: {
      userId: notFound(
        'MEMBER_NOT_FOUND',
        (world, actor) =>
          actor.patch(`${org(world)}/members/${world.ofB['userId']}`, {
            role: 'viewer',
            version: 1,
          }),
        'owner-of-A',
      ),
    },
  },
  'DELETE /organizations/:organizationId/members/:userId': {
    body: null,
    query: removeMemberQuerySchema,
    references: {
      userId: notFound(
        'MEMBER_NOT_FOUND',
        (world, actor) => actor.delete(`${org(world)}/members/${world.ofB['userId']}?version=1`),
        'owner-of-A',
      ),
    },
  },
  'GET /organizations/:organizationId/invitations': {
    body: null,
    query: pageQuerySchema,
    references: {
      list: noLeak((world, actor) => actor.get(`${org(world)}/invitations`), 'owner-of-A'),
      cursor: noLeak(
        (world, actor) =>
          actor.get(`${org(world)}/invitations?cursor=${world.ofB['membersCursor']}`),
        'owner-of-A',
      ),
    },
  },
  // Corpo sem ids (só e-mail e papel): o caso gerado (prefixo de B) basta.
  'POST /organizations/:organizationId/invitations': {
    body: inviteMemberRequestSchema,
    query: null,
    references: {},
  },
  'POST /organizations/:organizationId/invitations/:invitationId/resend': {
    body: emptyBody,
    query: null,
    references: {
      invitationId: notFound(
        'INVITATION_NOT_FOUND',
        (world, actor) =>
          actor.post(`${org(world)}/invitations/${world.ofB['invitationId']}/resend`),
        'owner-of-A',
      ),
    },
  },
  'DELETE /organizations/:organizationId/invitations/:invitationId': {
    body: null,
    query: null,
    references: {
      invitationId: notFound(
        'INVITATION_NOT_FOUND',
        (world, actor) => actor.delete(`${org(world)}/invitations/${world.ofB['invitationId']}`),
        'owner-of-A',
      ),
    },
  },

  // --- projects (spec 003) ---
  'GET /organizations/:organizationId/projects': {
    body: null,
    query: projectListQuerySchema,
    references: {
      list: noLeak((world, actor) => actor.get(`${org(world)}/projects`)),
      archived: noLeak((world, actor) => actor.get(`${org(world)}/projects?status=archived`)),
      cursor: noLeak((world, actor) =>
        actor.get(`${org(world)}/projects?cursor=${world.ofB['projectsCursor']}`),
      ),
    },
  },
  // Corpo sem ids; a chave de B criada em A é só uma chave de A (sem vazamento).
  'POST /organizations/:organizationId/projects': {
    body: createProjectRequestSchema,
    query: null,
    references: {},
  },
  'GET /organizations/:organizationId/projects/by-key/:key': {
    body: null,
    query: null,
    references: {
      key: notFound('PROJECT_NOT_FOUND', (world, actor) =>
        actor.get(`${org(world)}/projects/by-key/${world.ofB['key']}`),
      ),
    },
  },
  'GET /organizations/:organizationId/projects/:projectId': {
    body: null,
    query: null,
    references: { projectId: foreignProject('') },
  },
  'PATCH /organizations/:organizationId/projects/:projectId': {
    body: updateProjectRequestSchema,
    query: null,
    references: {
      projectId: foreignProject('', (actor, path) =>
        actor.patch(path, { description: 'Tomado', version: 1 }),
      ),
    },
  },
  'POST /organizations/:organizationId/projects/:projectId/archive': {
    body: projectVersionRequestSchema,
    query: null,
    references: {
      projectId: foreignProject('/archive', (actor, path) => actor.post(path, { version: 1 })),
    },
  },
  'POST /organizations/:organizationId/projects/:projectId/restore': {
    body: projectVersionRequestSchema,
    query: null,
    references: {
      projectId: foreignProject('/restore', (actor, path) => actor.post(path, { version: 1 })),
    },
  },
  'GET /organizations/:organizationId/projects/:projectId/workflow': {
    body: null,
    query: null,
    references: { projectId: foreignProject('/workflow') },
  },
  'GET /organizations/:organizationId/projects/:projectId/members': {
    body: null,
    query: pageQuerySchema,
    references: {
      projectId: foreignProject('/members'),
      cursor: noLeak((world, actor) =>
        actor.get(`${projectOfA(world)}/members?cursor=${world.ofB['projectMembersCursor']}`),
      ),
    },
  },
  'GET /organizations/:organizationId/projects/:projectId/member-candidates': {
    body: null,
    query: pageQuerySchema,
    references: {
      projectId: foreignProject('/member-candidates'),
      list: noLeak((world, actor) => actor.get(`${projectOfA(world)}/member-candidates`)),
      cursor: noLeak((world, actor) =>
        actor.get(`${projectOfA(world)}/member-candidates?cursor=${world.ofB['membersCursor']}`),
      ),
    },
  },
  'POST /organizations/:organizationId/projects/:projectId/members': {
    body: addProjectMemberRequestSchema,
    query: null,
    references: {
      projectId: foreignProject('/members', (actor, path) =>
        actor.post(path, { userId: '00000000-0000-7000-8000-000000000001', role: 'viewer' }),
      ),
      // Projeto de A válido; só a pessoa é de B (membro só de B).
      userId: notFound('MEMBER_NOT_FOUND', (world, actor) =>
        actor.post(`${projectOfA(world)}/members`, { userId: world.ofB['userId'], role: 'viewer' }),
      ),
    },
  },
  'PATCH /organizations/:organizationId/projects/:projectId/members/:userId': {
    body: changeProjectMemberRoleRequestSchema,
    query: null,
    references: {
      projectId: notFound('PROJECT_NOT_FOUND', (world, actor) =>
        actor.patch(`${projectOfB(world)}/members/${world.ofA.participantUserId}`, {
          role: 'viewer',
          version: 1,
        }),
      ),
      userId: notFound('PROJECT_MEMBER_NOT_FOUND', (world, actor) =>
        actor.patch(`${projectOfA(world)}/members/${world.ofB['participantUserId']}`, {
          role: 'viewer',
          version: 1,
        }),
      ),
    },
  },
  'DELETE /organizations/:organizationId/projects/:projectId/members/:userId': {
    body: null,
    query: removeProjectMemberQuerySchema,
    references: {
      projectId: notFound('PROJECT_NOT_FOUND', (world, actor) =>
        actor.delete(`${projectOfB(world)}/members/${world.ofA.participantUserId}?version=1`),
      ),
      userId: notFound('PROJECT_MEMBER_NOT_FOUND', (world, actor) =>
        actor.delete(`${projectOfA(world)}/members/${world.ofB['participantUserId']}?version=1`),
      ),
    },
  },

  // --- tasks (spec 004): caminho, corpo e query; `assigned` (eu/sem responsável) não é referência ---
  'GET /organizations/:organizationId/tasks': {
    body: null,
    query: taskListQuerySchema,
    references: {
      projectId: notFound('PROJECT_NOT_FOUND', (world, actor) =>
        actor.get(`${tasks(world)}?projectId=${world.ofB['projectId']}`),
      ),
      list: noLeak((world, actor) => actor.get(`${tasks(world)}?projectId=${world.ofA.projectId}`)),
      statusId: noLeak((world, actor) =>
        actor.get(
          `${tasks(world)}?projectId=${world.ofA.projectId}&statusId=${world.ofB['statusId']}`,
        ),
      ),
      assigneeUserId: noLeak((world, actor) =>
        actor.get(
          `${tasks(world)}?projectId=${world.ofA.projectId}&assigneeUserId=${world.ofB['userId']}`,
        ),
      ),
      parentTaskId: noLeak((world, actor) =>
        actor.get(
          `${tasks(world)}?projectId=${world.ofA.projectId}&parentTaskId=${world.ofB['taskId']}`,
        ),
      ),
      cursor: noLeak((world, actor) =>
        actor.get(
          `${tasks(world)}?projectId=${world.ofA.projectId}&cursor=${world.ofB['tasksCursor']}`,
        ),
      ),
    },
  },
  'POST /organizations/:organizationId/tasks': {
    body: createTaskRequestSchema,
    query: null,
    references: {
      projectId: notFound('PROJECT_NOT_FOUND', (world, actor) =>
        actor.post(tasks(world), { projectId: world.ofB['projectId'], title: 'Tomada' }),
      ),
      parentTaskId: notFound('TASK_NOT_FOUND', (world, actor) =>
        actor.post(tasks(world), {
          projectId: world.ofA.projectId,
          title: 'Tomada',
          parentTaskId: world.ofB['taskId'],
        }),
      ),
      assigneeUserId: refused('ASSIGNEE_NOT_PROJECT_MEMBER', (world, actor) =>
        actor.post(tasks(world), {
          projectId: world.ofA.projectId,
          title: 'Tomada',
          assigneeUserId: world.ofB['userId'],
        }),
      ),
    },
  },
  'GET /organizations/:organizationId/tasks/assignable-users': {
    body: null,
    query: assignableUsersQuerySchema,
    references: {
      projectId: notFound('PROJECT_NOT_FOUND', (world, actor) =>
        actor.get(`${tasks(world)}/assignable-users?projectId=${world.ofB['projectId']}`),
      ),
      list: noLeak((world, actor) =>
        actor.get(`${tasks(world)}/assignable-users?projectId=${world.ofA.projectId}`),
      ),
      cursor: noLeak((world, actor) =>
        actor.get(
          `${tasks(world)}/assignable-users?projectId=${world.ofA.projectId}&cursor=${world.ofB['assignableCursor']}`,
        ),
      ),
    },
  },
  'GET /organizations/:organizationId/tasks/by-key/:key': {
    body: null,
    query: null,
    references: {
      key: notFound('TASK_NOT_FOUND', (world, actor) =>
        actor.get(`${tasks(world)}/by-key/${world.ofB['taskKey']}`),
      ),
    },
  },
  'GET /organizations/:organizationId/tasks/:taskId': {
    body: null,
    query: null,
    references: { taskId: foreignTask('') },
  },
  'PATCH /organizations/:organizationId/tasks/:taskId': {
    body: updateTaskRequestSchema,
    query: null,
    references: {
      taskId: foreignTask('', (actor, path) => actor.patch(path, { title: 'Tomada', version: 1 })),
    },
  },
  'DELETE /organizations/:organizationId/tasks/:taskId': {
    body: null,
    query: deleteTaskQuerySchema,
    references: { taskId: foreignTask('', (actor, path) => actor.delete(`${path}?version=1`)) },
  },
  'PUT /organizations/:organizationId/tasks/:taskId/assignee': {
    body: assignTaskRequestSchema,
    query: null,
    references: {
      taskId: foreignTask('/assignee', (actor, path) =>
        actor.put(path, { assigneeUserId: null, version: 1 }),
      ),
      assigneeUserId: refused('ASSIGNEE_NOT_PROJECT_MEMBER', (world, actor) =>
        actor.put(`${taskOfA(world)}/assignee`, {
          assigneeUserId: world.ofB['userId'],
          version: 1,
        }),
      ),
    },
  },
  'POST /organizations/:organizationId/tasks/:taskId/transition': {
    body: transitionTaskRequestSchema,
    query: null,
    references: {
      taskId: foreignTask('/transition', (actor, path) =>
        actor.post(path, { statusId: '00000000-0000-7000-8000-000000000001', version: 1 }),
      ),
      statusId: notFound('STATUS_NOT_FOUND', (world, actor) =>
        actor.post(`${taskOfA(world)}/transition`, { statusId: world.ofB['statusId'], version: 1 }),
      ),
    },
  },
  'POST /organizations/:organizationId/tasks/:taskId/cancel': {
    body: taskVersionRequestSchema,
    query: null,
    references: {
      taskId: foreignTask('/cancel', (actor, path) => actor.post(path, { version: 1 })),
    },
  },
  'POST /organizations/:organizationId/tasks/:taskId/reopen': {
    body: taskVersionRequestSchema,
    query: null,
    references: {
      taskId: foreignTask('/reopen', (actor, path) => actor.post(path, { version: 1 })),
    },
  },
  'POST /organizations/:organizationId/tasks/:taskId/dependencies': {
    body: addDependencyRequestSchema,
    query: null,
    references: {
      taskId: foreignTask('/dependencies', (actor, path) =>
        actor.post(path, { blockingTaskId: '00000000-0000-7000-8000-000000000001' }),
      ),
      blockingTaskId: notFound('TASK_NOT_FOUND', (world, actor) =>
        actor.post(`${taskOfA(world)}/dependencies`, { blockingTaskId: world.ofB['taskId'] }),
      ),
    },
  },
  'DELETE /organizations/:organizationId/tasks/:taskId/dependencies/:blockingTaskId': {
    body: null,
    query: null,
    references: {
      taskId: notFound('TASK_NOT_FOUND', (world, actor) =>
        actor.delete(`${taskOfB(world)}/dependencies/${world.ofB['blockingTaskId']}`),
      ),
      blockingTaskId: notFound('DEPENDENCY_NOT_FOUND', (world, actor) =>
        actor.delete(`${taskOfA(world)}/dependencies/${world.ofB['blockingTaskId']}`),
      ),
    },
  },

  // --- workflow configurável (spec 005): listas e referências aninhadas (achado A1) ---
  'POST /organizations/:organizationId/projects/:projectId/workflow/statuses': {
    body: createStatusRequestSchema,
    query: null,
    references: {
      projectId: foreignProject('/workflow/statuses', (actor, path) =>
        actor.post(path, { name: 'Tomada', category: 'todo', version: 1 }),
      ),
    },
  },
  'PATCH /organizations/:organizationId/projects/:projectId/workflow/statuses/:statusId': {
    body: updateStatusRequestSchema,
    query: null,
    references: {
      projectId: notFound('PROJECT_NOT_FOUND', (world, actor) =>
        actor.patch(`${projectOfB(world)}/workflow/statuses/${world.ofA.statusIds[0] ?? ''}`, {
          name: 'Tomada',
          version: 1,
        }),
      ),
      statusId: notFound('STATUS_NOT_FOUND', (world, actor) =>
        actor.patch(`${projectOfA(world)}/workflow/statuses/${world.ofB['statusId']}`, {
          name: 'Tomada',
          version: 1,
        }),
      ),
    },
  },
  'DELETE /organizations/:organizationId/projects/:projectId/workflow/statuses/:statusId': {
    body: null,
    query: removeStatusQuerySchema,
    references: {
      projectId: notFound('PROJECT_NOT_FOUND', (world, actor) =>
        actor.delete(
          `${projectOfB(world)}/workflow/statuses/${world.ofA.statusIds[1] ?? ''}?version=1`,
        ),
      ),
      statusId: notFound('STATUS_NOT_FOUND', (world, actor) =>
        actor.delete(`${projectOfA(world)}/workflow/statuses/${world.ofB['statusId']}?version=1`),
      ),
      // Status de A em uso? Não: "Em andamento" de A está vazio; o destino de B é barrado antes.
      moveTasksToStatusId: notFound('STATUS_NOT_FOUND', (world, actor) =>
        actor.delete(
          `${projectOfA(world)}/workflow/statuses/${world.ofA.statusIds[1] ?? ''}?version=1&moveTasksToStatusId=${world.ofB['statusId']}`,
        ),
      ),
    },
  },
  'PUT /organizations/:organizationId/projects/:projectId/workflow/order': {
    body: reorderStatusesRequestSchema,
    query: null,
    references: {
      projectId: foreignProject('/workflow/order', (actor, path) =>
        actor.put(path, { statusIds: ['00000000-0000-7000-8000-000000000001'], version: 1 }),
      ),
      statusIds: notFound('STATUS_NOT_FOUND', (world, actor) =>
        actor.put(`${projectOfA(world)}/workflow/order`, {
          statusIds: [...world.ofA.statusIds.slice(0, 2), world.ofB['statusId']],
          version: 1,
        }),
      ),
    },
  },
  'PUT /organizations/:organizationId/projects/:projectId/workflow/transitions': {
    body: replaceTransitionsRequestSchema,
    query: null,
    references: {
      projectId: foreignProject('/workflow/transitions', (actor, path) =>
        actor.put(path, { transitions: [], version: 1 }),
      ),
      'transitions[].fromStatusId': notFound('STATUS_NOT_FOUND', (world, actor) =>
        actor.put(`${projectOfA(world)}/workflow/transitions`, {
          transitions: [
            { fromStatusId: world.ofB['statusId'], toStatusId: world.ofA.statusIds[0] },
          ],
          version: 1,
        }),
      ),
      'transitions[].toStatusId': notFound('STATUS_NOT_FOUND', (world, actor) =>
        actor.put(`${projectOfA(world)}/workflow/transitions`, {
          transitions: [
            { fromStatusId: world.ofA.statusIds[0], toStatusId: world.ofB['statusId'] },
          ],
          version: 1,
        }),
      ),
    },
  },

  // --- quadro (spec 005) ---
  'GET /organizations/:organizationId/board': {
    body: null,
    query: boardQuerySchema,
    references: {
      projectId: notFound('PROJECT_NOT_FOUND', (world, actor) =>
        actor.get(`${org(world)}/board?projectId=${world.ofB['projectId']}`),
      ),
      list: noLeak((world, actor) =>
        actor.get(`${org(world)}/board?projectId=${world.ofA.projectId}`),
      ),
    },
  },
  'GET /organizations/:organizationId/board/columns/:statusId': {
    body: null,
    query: columnQuerySchema,
    references: {
      projectId: notFound('PROJECT_NOT_FOUND', (world, actor) =>
        actor.get(
          `${org(world)}/board/columns/${world.ofA.statusIds[0] ?? ''}?projectId=${world.ofB['projectId']}`,
        ),
      ),
      statusId: notFound('STATUS_NOT_FOUND', (world, actor) =>
        actor.get(
          `${org(world)}/board/columns/${world.ofB['statusId']}?projectId=${world.ofA.projectId}`,
        ),
      ),
      // Cursor de uma coluna de B: amarrado à coluna dele ⇒ 400, sem chegar ao banco (B3).
      cursor: refused(
        'INVALID_CURSOR',
        (world, actor) =>
          actor.get(
            `${org(world)}/board/columns/${world.ofA.statusIds[0] ?? ''}?projectId=${world.ofA.projectId}&cursor=${world.ofB['boardCursor']}`,
          ),
        400,
      ),
    },
  },
  'POST /organizations/:organizationId/tasks/:taskId/move': {
    body: moveCardRequestSchema,
    query: null,
    references: {
      taskId: foreignTask('/move', (actor, path) =>
        actor.post(path, { toStatusId: '00000000-0000-7000-8000-000000000001', version: 1 }),
      ),
      toStatusId: notFound('STATUS_NOT_FOUND', (world, actor) =>
        actor.post(`${taskOfA(world)}/move`, { toStatusId: world.ofB['statusId'], version: 1 }),
      ),
      afterTaskId: refused('INVALID_POSITION', (world, actor) =>
        actor.post(`${taskOfA(world)}/move`, {
          toStatusId: world.ofA.statusIds[0],
          afterTaskId: world.ofB['taskId'],
          version: 1,
        }),
      ),
      beforeTaskId: refused('INVALID_POSITION', (world, actor) =>
        actor.post(`${taskOfA(world)}/move`, {
          toStatusId: world.ofA.statusIds[0],
          beforeTaskId: world.ofB['taskId'],
          version: 1,
        }),
      ),
    },
  },

  // --- collaboration (spec 010): menções no texto são referências (`body.mentions`) ---
  'GET /organizations/:organizationId/tasks/:taskId/comments': {
    body: null,
    query: commentListQuerySchema,
    references: {
      taskId: foreignTask('/comments'),
      // Cursor real de B, amarrado à tarefa de B: recusado sem chegar ao banco.
      cursor: refused(
        'INVALID_CURSOR',
        (world, actor) =>
          actor.get(`${taskOfA(world)}/comments?cursor=${world.ofB['commentsCursor']}`),
        400,
      ),
    },
  },
  'POST /organizations/:organizationId/tasks/:taskId/comments': {
    body: createCommentRequestSchema,
    query: null,
    references: {
      taskId: foreignTask('/comments', (actor, path) => actor.post(path, { body: 'oi' })),
      'body.mentions': refused('INVALID_MENTION', (world, actor) =>
        actor.post(`${taskOfA(world)}/comments`, { body: `oi <@${world.ofB['userId']}>` }),
      ),
    },
  },
  'GET /organizations/:organizationId/tasks/:taskId/mentionable-users': {
    body: null,
    query: mentionCandidatesQuerySchema,
    references: {
      taskId: foreignTask('/mentionable-users?query=a'),
      cursor: refused(
        'INVALID_CURSOR',
        (world, actor) =>
          actor.get(
            `${taskOfA(world)}/mentionable-users?query=a&cursor=${world.ofB['commentsCursor']}`,
          ),
        400,
      ),
    },
  },
  'GET /organizations/:organizationId/comments/:commentId': {
    body: null,
    query: null,
    references: {
      commentId: notFound('COMMENT_NOT_FOUND', (world, actor) =>
        actor.get(`${org(world)}/comments/${world.ofB['commentId']}`),
      ),
    },
  },
  'PATCH /organizations/:organizationId/comments/:commentId': {
    body: editCommentRequestSchema,
    query: null,
    references: {
      commentId: notFound('COMMENT_NOT_FOUND', (world, actor) =>
        actor.patch(`${org(world)}/comments/${world.ofB['commentId']}`, { body: 'x', version: 1 }),
      ),
      // Só o membro duplo é autor do comentário de A: o owner recebe 403 antes da menção.
      'body.mentions': {
        ...refused('INVALID_MENTION', (world, actor) =>
          actor.patch(`${org(world)}/comments/${world.ofA.commentId}`, {
            body: `oi <@${world.ofB['userId']}>`,
            version: 1,
          }),
        ),
        actors: 'dual-member',
      },
    },
  },
  'DELETE /organizations/:organizationId/comments/:commentId': {
    body: null,
    query: null,
    references: {
      commentId: notFound('COMMENT_NOT_FOUND', (world, actor) =>
        actor.delete(`${org(world)}/comments/${world.ofB['commentId']}?version=1`),
      ),
    },
  },
};

/**
 * Rotas fora do escopo do tenant, com a justificativa. Rota global nova sem entrada aqui, ou com
 * `:organizationId`, derruba o teste de cobertura.
 */
export const GLOBAL_ROUTES: Readonly<Record<RouteKey, string>> = {
  'GET /auth/csrf': 'identidade: emite o cookie CSRF',
  'POST /auth/register': 'identidade: cadastro',
  'POST /auth/login': 'identidade: login',
  'POST /auth/refresh': 'identidade: renovação de sessão',
  'POST /auth/logout': 'identidade: logout',
  'POST /auth/email-verification/resend': 'identidade: própria conta',
  'POST /auth/email-verification/confirm': 'identidade: própria conta',
  'POST /auth/password/forgot': 'identidade: recuperação de senha',
  'POST /auth/password/reset': 'identidade: recuperação de senha',
  'GET /me': 'identidade: própria conta',
  'POST /me/password': 'identidade: própria conta',
  'GET /me/sessions': 'identidade: sessões da própria conta',
  'DELETE /me/sessions/:sessionId': 'identidade: sessão da própria conta (404 para alheia)',
  'POST /organizations': 'cria organização nova (sem tenant ativo)',
  'GET /me/organizations': 'só organizações do próprio ator (testado no isolamento)',
  'POST /invitations/lookup': 'token do convite; e-mail mascarado',
  'POST /invitations/accept': 'token do convite; só a conta convidada',
};
