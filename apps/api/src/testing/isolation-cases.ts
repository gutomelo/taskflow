import type { Response } from 'supertest';
import type { IsolationExpectation, RouteKey } from './tenant-isolation';

/** Cliente HTTP autenticado (sessão + CSRF) usado nos casos. */
export interface TestClient {
  get(path: string): Promise<Response>;
  post(path: string, body?: object): Promise<Response>;
  patch(path: string, body?: object): Promise<Response>;
  delete(path: string): Promise<Response>;
}

/** Duas organizações semeadas: o ator é **owner de A** (papel de maior privilégio). */
export interface IsolationWorld {
  readonly orgA: string;
  readonly orgB: string;
  /** Ids reais de recursos de B, por nome de parâmetro de caminho. */
  readonly ofB: Readonly<Record<string, string>>;
  readonly asOwnerOfA: TestClient;
}

export type IsolationVariant = Readonly<{
  expect: IsolationExpectation;
  call: (world: IsolationWorld) => Promise<Response>;
}>;

export type IsolationCase = Readonly<{ references: Readonly<Record<string, IsolationVariant>> }>;

const notFound = (call: IsolationVariant['call']): IsolationVariant => ({
  expect: 'not-found',
  call,
});
const noLeak = (call: IsolationVariant['call']): IsolationVariant => ({ expect: 'no-leak', call });

/**
 * Casos por rota do escopo do tenant (spec 006, CA-07). Além destes, o harness gera para **toda**
 * rota a chamada com o prefixo de B (⇒ 404). Cada parâmetro de caminho precisa de variante com id
 * real de B sob o prefixo de A; referências no corpo ou na query (specs 003+) também entram aqui.
 */
export const ISOLATION_CASES: Readonly<Record<RouteKey, IsolationCase>> = {
  'GET /organizations/:organizationId': { references: {} },
  'PATCH /organizations/:organizationId': { references: {} },
  'GET /organizations/:organizationId/members': {
    references: {
      list: noLeak((world) => world.asOwnerOfA.get(`/organizations/${world.orgA}/members`)),
    },
  },
  'PATCH /organizations/:organizationId/members/:userId': {
    references: {
      userId: notFound((world) =>
        world.asOwnerOfA.patch(`/organizations/${world.orgA}/members/${world.ofB['userId']}`, {
          role: 'viewer',
          version: 1,
        }),
      ),
    },
  },
  'DELETE /organizations/:organizationId/members/:userId': {
    references: {
      userId: notFound((world) =>
        world.asOwnerOfA.delete(
          `/organizations/${world.orgA}/members/${world.ofB['userId']}?version=1`,
        ),
      ),
    },
  },
  'GET /organizations/:organizationId/invitations': {
    references: {
      list: noLeak((world) => world.asOwnerOfA.get(`/organizations/${world.orgA}/invitations`)),
    },
  },
  // Corpo sem ids (só e-mail e papel): o caso gerado (prefixo de B) basta.
  'POST /organizations/:organizationId/invitations': { references: {} },
  'POST /organizations/:organizationId/invitations/:invitationId/resend': {
    references: {
      invitationId: notFound((world) =>
        world.asOwnerOfA.post(
          `/organizations/${world.orgA}/invitations/${world.ofB['invitationId']}/resend`,
        ),
      ),
    },
  },
  'DELETE /organizations/:organizationId/invitations/:invitationId': {
    references: {
      invitationId: notFound((world) =>
        world.asOwnerOfA.delete(
          `/organizations/${world.orgA}/invitations/${world.ofB['invitationId']}`,
        ),
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
