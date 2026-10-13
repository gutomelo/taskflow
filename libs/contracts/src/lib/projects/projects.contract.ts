import { z } from 'zod';
import { organizationRoleSchema, pageQuerySchema } from '../organizations/organizations.contract';

/**
 * Contratos HTTP de Projects (spec 003). Formato na fronteira; regras (BR-025…BR-027, texto
 * exibível) no domínio. Limites de tamanho folgados só contra payloads abusivos.
 */
export const projectRoleSchema = z.enum(['manager', 'member', 'viewer']);
export type ProjectRole = z.infer<typeof projectRoleSchema>;

/** Permissões de projeto (espelho do catálogo do kernel; paridade testada em `projects/http`). */
export const projectPermissionSchema = z.enum([
  'project:read',
  'project:update',
  'project:archive',
  'project-member:manage',
  'task:create',
  'task:update',
  'task:assign',
  'task:delete',
  'comment:create',
  'comment:update',
  'comment:delete',
  'sprint:manage',
  'board:configure',
]);
export type ProjectPermission = z.infer<typeof projectPermissionSchema>;

export const statusCategorySchema = z.enum(['todo', 'in_progress', 'done']);
export type StatusCategory = z.infer<typeof statusCategorySchema>;

const versionField = z.int().min(1);
/** O formato da chave (BR-025) é do domínio: `INVALID_PROJECT_KEY` com mensagem própria. */
const keyField = z.string().max(20);
const nameField = z.string().max(200);
const descriptionField = z.string().max(4000).nullable();

export const createProjectRequestSchema = z.strictObject({
  key: keyField,
  name: nameField,
  description: descriptionField.optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

/** Nome e/ou descrição, com a versão (BR-008). A chave não muda (BR-025). */
export const updateProjectRequestSchema = z
  .strictObject({
    name: nameField.optional(),
    description: descriptionField.optional(),
    version: versionField,
  })
  .refine((value) => value.name !== undefined || value.description !== undefined, {
    message: 'Informe ao menos um campo para alterar',
    path: ['(body)'],
  });
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

/** Arquivar e restaurar (BR-008, BR-026). */
export const projectVersionRequestSchema = z.strictObject({ version: versionField });
export type ProjectVersionRequest = z.infer<typeof projectVersionRequestSchema>;

export const projectSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  archivedAt: z.iso.datetime().nullable(),
  version: z.int(),
  createdAt: z.iso.datetime(),
  /** Papel efetivo (BR-023). */
  myRole: projectRoleSchema,
  /** Capacidades do usuário no projeto (dica de interface; a API sempre decide). */
  capabilities: z.array(projectPermissionSchema),
});
export type ProjectDto = z.infer<typeof projectSchema>;

export const projectSummarySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  archived: z.boolean(),
  myRole: projectRoleSchema,
});
export type ProjectSummary = z.infer<typeof projectSummarySchema>;

export const projectPageSchema = z.object({
  items: z.array(projectSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ProjectPage = z.infer<typeof projectPageSchema>;

/** `?status=active|archived` (padrão: ativos) além de `limit` e `cursor`. */
export const projectListQuerySchema = pageQuerySchema.extend({
  status: z.enum(['active', 'archived']).optional(),
});

export const projectIdParamSchema = z.object({ projectId: z.uuid() });
/** Formato da BR-025 já na rota: chave malformada responde 404 sem chegar ao banco. */
export const projectKeyParamSchema = z.object({ key: z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/) });
export const projectMemberParamSchema = z.object({ projectId: z.uuid(), userId: z.uuid() });

export const workflowSchema = z.object({
  statuses: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      category: statusCategorySchema,
      position: z.int(),
    }),
  ),
  transitions: z.array(z.object({ fromStatusId: z.uuid(), toStatusId: z.uuid() })),
});
export type WorkflowDto = z.infer<typeof workflowSchema>;

export const projectMemberSchema = z.object({
  userId: z.uuid(),
  /** Nulos só se a conta sumir de `identity`. */
  name: z.string().nullable(),
  email: z.string().nullable(),
  /** Papel gravado; `effectiveRole` aplica o teto da organização (BR-023). */
  role: projectRoleSchema,
  effectiveRole: projectRoleSchema,
  version: z.int(),
  joinedAt: z.iso.datetime(),
  actions: z.object({
    /** Papéis para os quais o usuário atual pode alterá-lo (sem o atual). */
    changeRoleTo: z.array(projectRoleSchema),
    /** Se pode removê-lo (falso para si: sair tem ação própria). */
    remove: z.boolean(),
    /** Se é o próprio usuário (pode sair). */
    leave: z.boolean(),
  }),
});
export type ProjectMemberDto = z.infer<typeof projectMemberSchema>;

export const projectMemberPageSchema = z.object({
  items: z.array(projectMemberSchema),
  nextCursor: z.string().nullable(),
});
export type ProjectMemberPage = z.infer<typeof projectMemberPageSchema>;

export const memberCandidateSchema = z.object({
  userId: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  organizationRole: organizationRoleSchema,
  /** Papéis que podem ser dados a ele (teto, BR-027). */
  allowedRoles: z.array(projectRoleSchema),
});
export type MemberCandidate = z.infer<typeof memberCandidateSchema>;

export const memberCandidatePageSchema = z.object({
  items: z.array(memberCandidateSchema),
  nextCursor: z.string().nullable(),
});
export type MemberCandidatePage = z.infer<typeof memberCandidatePageSchema>;

/** Só membros da organização (BR-027); `organizationId` nunca vem do cliente. */
export const addProjectMemberRequestSchema = z.strictObject({
  userId: z.uuid(),
  role: projectRoleSchema,
});
export type AddProjectMemberRequest = z.infer<typeof addProjectMemberRequestSchema>;

export const changeProjectMemberRoleRequestSchema = z.strictObject({
  role: projectRoleSchema,
  version: versionField,
});
export type ChangeProjectMemberRoleRequest = z.infer<typeof changeProjectMemberRoleRequestSchema>;

/** `DELETE /projects/{projectId}/members/{userId}?version` (BR-008). */
export const removeProjectMemberQuerySchema = z.object({ version: z.coerce.number().int().min(1) });
