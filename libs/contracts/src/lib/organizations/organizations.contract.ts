import { z } from 'zod';

/**
 * Contratos HTTP de Organizations (spec 002). Formato na fronteira; regras (BR-020…BR-022, texto
 * exibível) no domínio. Limites de tamanho folgados só contra payloads abusivos.
 */
export const organizationRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

/** BR-021: convites nunca concedem `owner`. */
export const invitableRoleSchema = z.enum(['admin', 'member', 'viewer']);
export type InvitableRole = z.infer<typeof invitableRoleSchema>;

const nameField = z.string().max(200);
const versionField = z.int().min(1);
const tokenField = z.string().min(16).max(256);

export const createOrganizationRequestSchema = z.strictObject({
  name: nameField,
  slug: z.string().max(64),
});
export type CreateOrganizationRequest = z.infer<typeof createOrganizationRequestSchema>;

export const renameOrganizationRequestSchema = z.strictObject({
  name: nameField,
  version: versionField,
});
export type RenameOrganizationRequest = z.infer<typeof renameOrganizationRequestSchema>;

export const organizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  version: z.int(),
  createdAt: z.iso.datetime(),
  myRole: organizationRoleSchema,
});
export type OrganizationDto = z.infer<typeof organizationSchema>;

export const myOrganizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  role: organizationRoleSchema,
});
export type MyOrganization = z.infer<typeof myOrganizationSchema>;

export const myOrganizationListSchema = z.object({ items: z.array(myOrganizationSchema) });
export type MyOrganizationList = z.infer<typeof myOrganizationListSchema>;

/** `?limit&cursor` (RNF-06): padrão 25, máximo 100; cursor opaco. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const memberSchema = z.object({
  userId: z.uuid(),
  /** Nulos só se a conta sumir de `identity` (não ocorre com contas verificadas). */
  name: z.string().nullable(),
  email: z.string().nullable(),
  role: organizationRoleSchema,
  version: z.int(),
  joinedAt: z.iso.datetime(),
});
export type Member = z.infer<typeof memberSchema>;

export const memberPageSchema = z.object({
  items: z.array(memberSchema),
  nextCursor: z.string().nullable(),
});
export type MemberPage = z.infer<typeof memberPageSchema>;

export const memberUserIdParamSchema = z.object({ userId: z.uuid() });

export const changeMemberRoleRequestSchema = z.strictObject({
  role: organizationRoleSchema,
  version: versionField,
});
export type ChangeMemberRoleRequest = z.infer<typeof changeMemberRoleRequestSchema>;

/** `DELETE /members/{userId}?version` (BR-008). */
export const removeMemberQuerySchema = z.object({ version: z.coerce.number().int().min(1) });

export const inviteMemberRequestSchema = z.strictObject({
  email: z.string().trim().min(3).max(254),
  role: invitableRoleSchema,
});
export type InviteMemberRequest = z.infer<typeof inviteMemberRequestSchema>;

/** Igual para e-mail com ou sem conta (sem `hasAccount`, nome ou status da conta convidada). */
export const invitationSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  role: invitableRoleSchema,
  status: z.enum(['pending', 'expired']),
  invitedBy: z.object({ userId: z.uuid(), name: z.string().nullable() }),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type InvitationDto = z.infer<typeof invitationSchema>;

export const invitationPageSchema = z.object({
  items: z.array(invitationSchema),
  nextCursor: z.string().nullable(),
});
export type InvitationPage = z.infer<typeof invitationPageSchema>;

export const invitationIdParamSchema = z.object({ invitationId: z.uuid() });

/** Token do fragmento da URL do e-mail, enviado no corpo (nunca na query). */
export const invitationTokenRequestSchema = z.strictObject({ token: tokenField });
export type InvitationTokenRequest = z.infer<typeof invitationTokenRequestSchema>;

export const invitationPreviewSchema = z.object({
  organizationName: z.string(),
  role: invitableRoleSchema,
  invitedByName: z.string().nullable(),
  /** `b***@exemplo.com`: reconhecível sem expor o endereço a outra conta. */
  maskedEmail: z.string(),
  isForCurrentUser: z.boolean(),
  expiresAt: z.iso.datetime(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;
