import type { ZodOpenApiPathsObject } from 'zod-openapi';
import { z } from 'zod';
import { problemResponse, SECURITY } from '@taskflow/backend/shared/http';
import {
  changeMemberRoleRequestSchema,
  createOrganizationRequestSchema,
  invitableRoleSchema,
  invitationIdParamSchema,
  invitationPageSchema,
  invitationPreviewSchema,
  invitationSchema,
  invitationTokenRequestSchema,
  inviteMemberRequestSchema,
  memberPageSchema,
  memberSchema,
  memberUserIdParamSchema,
  myOrganizationListSchema,
  myOrganizationSchema,
  organizationRoleSchema,
  organizationSchema,
  pageQuerySchema,
  removeMemberQuerySchema,
  renameOrganizationRequestSchema,
} from '@taskflow/contracts';

/** Componentes reutilizáveis do contexto organizations no documento OpenAPI. */
export const organizationsOpenApiSchemas = {
  OrganizationRole: organizationRoleSchema,
  InvitableRole: invitableRoleSchema,
  Organization: organizationSchema,
  MyOrganization: myOrganizationSchema,
  MyOrganizationList: myOrganizationListSchema,
  Member: memberSchema,
  MemberPage: memberPageSchema,
  Invitation: invitationSchema,
  InvitationPage: invitationPageSchema,
  InvitationPreview: invitationPreviewSchema,
};

const json = <T>(schema: T) => ({ content: { 'application/json': { schema } } });
const noContent = (description: string) => ({ description });
const tooMany = problemResponse('Limite excedido (Retry-After)');
const unauthenticated = problemResponse('Não autenticado ou sessão encerrada');
const csrfOrForbidden = (detail: string) => problemResponse(`${detail} ou falha de CSRF`);
const notMember = problemResponse(
  'Organização inexistente ou sem membership (mesma resposta: não revela existência — ADR 0012)',
);
const tags = ['Organizations'];
const organizationPath = { path: z.object({ organizationId: z.uuid() }) };

/** Rotas de `createOrganizationsRouters` (spec 002). Mantenha em sincronia com o router. */
export const organizationsOpenApiPaths: ZodOpenApiPathsObject = {
  '/api/v1/organizations': {
    post: {
      tags,
      summary: 'Cria organização; o ator vira owner (RF-01, BR-013, BR-022)',
      security: SECURITY.authenticatedWithCsrf,
      requestBody: json(createOrganizationRequestSchema),
      responses: {
        '201': { description: 'Criada (header Location)', ...json(organizationSchema) },
        '400': problemResponse('Nome ou slug inválido (INVALID_ORGANIZATION_NAME, INVALID_SLUG)'),
        '401': unauthenticated,
        '403': csrfOrForbidden('E-mail não verificado (EMAIL_NOT_VERIFIED)'),
        '409': problemResponse('Slug em uso (SLUG_TAKEN)'),
        '422': problemResponse('Limite de organizações (ORGANIZATION_LIMIT_REACHED)'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/me/organizations': {
    get: {
      tags,
      summary: 'Organizações do usuário com o papel dele (RF-02)',
      security: SECURITY.authenticated,
      responses: {
        '200': { description: 'Minhas organizações', ...json(myOrganizationListSchema) },
        '401': unauthenticated,
      },
    },
  },
  '/api/v1/invitations/lookup': {
    post: {
      tags,
      summary: 'Prévia do convite pelo token do fragmento (e-mail mascarado; nada é consumido)',
      security: SECURITY.authenticatedWithCsrf,
      requestBody: json(invitationTokenRequestSchema),
      responses: {
        '200': { description: 'Prévia', ...json(invitationPreviewSchema) },
        '400': problemResponse('Convite inválido ou expirado (INVALID_OR_EXPIRED_INVITATION)'),
        '401': unauthenticated,
        '403': csrfOrForbidden('Proibido'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/invitations/accept': {
    post: {
      tags,
      summary: 'Aceita o convite (conta com o e-mail convidado e verificado — BR-020)',
      security: SECURITY.authenticatedWithCsrf,
      requestBody: json(invitationTokenRequestSchema),
      responses: {
        '200': { description: 'Membro da organização', ...json(myOrganizationSchema) },
        '400': problemResponse('Convite inválido, expirado, revogado ou usado'),
        '401': unauthenticated,
        '403': csrfOrForbidden(
          'EMAIL_NOT_VERIFIED ou INVITATION_FOR_ANOTHER_ACCOUNT (sem consumir)',
        ),
        '409': problemResponse('Já é membro (ALREADY_A_MEMBER)'),
        '422': problemResponse('Limite de memberships (ORGANIZATION_LIMIT_REACHED)'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/organizations/{organizationId}': {
    get: {
      tags,
      summary: 'Organização ativa com o meu papel',
      security: SECURITY.authenticated,
      requestParams: organizationPath,
      responses: {
        '200': { description: 'Organização', ...json(organizationSchema) },
        '401': unauthenticated,
        '404': notMember,
      },
    },
    patch: {
      tags,
      summary: 'Renomeia (owner, admin; BR-008)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: organizationPath,
      requestBody: json(renameOrganizationRequestSchema),
      responses: {
        '200': { description: 'Renomeada', ...json(organizationSchema) },
        '400': problemResponse('Nome inválido'),
        '401': unauthenticated,
        '403': csrfOrForbidden('Papel insuficiente (INSUFFICIENT_ROLE)'),
        '404': notMember,
        '409': problemResponse('VERSION_CONFLICT'),
      },
    },
  },
  '/api/v1/organizations/{organizationId}/members': {
    get: {
      tags,
      summary: 'Membros por cursor: nome, e-mail, papel (RF-09)',
      security: SECURITY.authenticated,
      requestParams: { ...organizationPath, query: pageQuerySchema },
      responses: {
        '200': { description: 'Página de membros', ...json(memberPageSchema) },
        '400': problemResponse('Parâmetros de página inválidos'),
        '401': unauthenticated,
        '404': notMember,
      },
    },
  },
  '/api/v1/organizations/{organizationId}/members/{userId}': {
    patch: {
      tags,
      summary: 'Altera o papel (BR-019, BR-021, BR-008)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: organizationPath.path.extend(memberUserIdParamSchema.shape) },
      requestBody: json(changeMemberRoleRequestSchema),
      responses: {
        '200': { description: 'Membro atualizado', ...json(memberSchema) },
        '401': unauthenticated,
        '403': csrfOrForbidden('INSUFFICIENT_ROLE ou ROLE_CHANGE_NOT_ALLOWED'),
        '404': problemResponse('Organização ou membro não encontrado (MEMBER_NOT_FOUND)'),
        '409': problemResponse('LAST_OWNER ou VERSION_CONFLICT'),
      },
    },
    delete: {
      tags,
      summary: 'Remove o membro; o próprio usuário = sair (RF-11, RF-12)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: {
        path: organizationPath.path.extend(memberUserIdParamSchema.shape),
        query: removeMemberQuerySchema,
      },
      responses: {
        '204': noContent('Removido'),
        '400': problemResponse('`version` ausente ou inválida'),
        '401': unauthenticated,
        '403': csrfOrForbidden('Papel insuficiente'),
        '404': problemResponse('Organização ou membro não encontrado'),
        '409': problemResponse('LAST_OWNER ou VERSION_CONFLICT'),
      },
    },
  },
  '/api/v1/organizations/{organizationId}/invitations': {
    get: {
      tags,
      summary: 'Convites abertos (pendentes e expirados) por cursor (owner, admin)',
      security: SECURITY.authenticated,
      requestParams: { ...organizationPath, query: pageQuerySchema },
      responses: {
        '200': { description: 'Página de convites', ...json(invitationPageSchema) },
        '401': unauthenticated,
        '403': problemResponse('Papel insuficiente'),
        '404': notMember,
      },
    },
    post: {
      tags,
      summary: 'Convida por e-mail; reconvite atualiza o papel e reenvia (RF-06, BR-020)',
      description: 'Resposta idêntica para e-mail com ou sem conta.',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: organizationPath,
      requestBody: json(inviteMemberRequestSchema),
      responses: {
        '201': { description: 'Convite novo', ...json(invitationSchema) },
        '200': { description: 'Convite aberto atualizado e reenviado', ...json(invitationSchema) },
        '400': problemResponse('E-mail ou papel inválido'),
        '401': unauthenticated,
        '403': csrfOrForbidden('Papel insuficiente'),
        '404': notMember,
        '409': problemResponse('Já é membro (ALREADY_A_MEMBER)'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/organizations/{organizationId}/invitations/{invitationId}/resend': {
    post: {
      tags,
      summary: 'Reenvia: novo link, o anterior deixa de valer (CA-06)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: organizationPath.path.extend(invitationIdParamSchema.shape) },
      responses: {
        '202': noContent('Reenvio agendado'),
        '401': unauthenticated,
        '403': csrfOrForbidden('Papel insuficiente'),
        '404': problemResponse('Organização ou convite não encontrado'),
        '429': tooMany,
      },
    },
  },
  '/api/v1/organizations/{organizationId}/invitations/{invitationId}': {
    delete: {
      tags,
      summary: 'Revoga o convite (CA-06)',
      security: SECURITY.authenticatedWithCsrf,
      requestParams: { path: organizationPath.path.extend(invitationIdParamSchema.shape) },
      responses: {
        '204': noContent('Revogado'),
        '401': unauthenticated,
        '403': csrfOrForbidden('Papel insuficiente'),
        '404': problemResponse('Organização ou convite não encontrado (inclusive já encerrado)'),
      },
    },
  },
};
