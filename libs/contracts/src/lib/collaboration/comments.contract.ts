import { z } from 'zod';

/**
 * Contratos HTTP de comentários e menções (spec 010). O texto é simples; menções são tokens
 * `<@uuid>` dentro dele (D3) — o cliente nunca envia lista de menções nem autor.
 */

/**
 * Gramática do token de menção. Espelha `MENTION_TOKEN` de `collaboration/domain` (o domínio não
 * importa contratos); a paridade é testada na camada HTTP.
 */
export const MENTION_TOKEN_PATTERN =
  /<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

/**
 * Campos de texto que carregam referências a outros recursos (spec 010, B1 da segurança): o harness
 * de isolamento exige variantes para eles a partir deste registro — falha fechado pelo schema.
 */
export const embeddedReferences = z.registry<{ kind: 'mentions' }>();

/** Limite de transporte; a regra (1–5 000 code points depois de normalizar) é do domínio. */
export const commentBodySchema = z.string().min(1).max(10_000);
commentBodySchema.register(embeddedReferences, { kind: 'mentions' });

export const commentIdParamSchema = z.object({ commentId: z.uuid() });

export const createCommentRequestSchema = z.strictObject({ body: commentBodySchema });
export type CreateCommentRequest = z.infer<typeof createCommentRequestSchema>;

export const editCommentRequestSchema = z.strictObject({
  body: commentBodySchema,
  version: z.int().min(1),
});
export type EditCommentRequest = z.infer<typeof editCommentRequestSchema>;

export const deleteCommentQuerySchema = z.object({ version: z.coerce.number().int().min(1) });

export const commentListQuerySchema = z.object({
  cursor: z.string().min(1).max(1024).optional(),
  /** Padrão 25, máximo 100. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const mentionCandidatesQuerySchema = z.object({
  query: z.string().trim().min(1).max(50),
  cursor: z.string().min(1).max(1024).optional(),
  /** Padrão 20, máximo 50. */
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** `name: null` = "Ex-membro" (não é mais membro da organização). */
export const commentPersonSchema = z.object({ userId: z.uuid(), name: z.string().nullable() });
export type CommentPerson = z.infer<typeof commentPersonSchema>;

export const commentSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  author: commentPersonSchema,
  /** Tokens `<@id>` canônicos; `null` = comentário removido. */
  body: z.string().nullable(),
  mentions: z.array(commentPersonSchema),
  createdAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
  deletedAt: z.iso.datetime().nullable(),
  version: z.int(),
  /** Capacidades do usuário (dica de interface; a API decide). */
  actions: z.object({ edit: z.boolean(), delete: z.boolean() }),
});
export type CommentDto = z.infer<typeof commentSchema>;

export const commentPageSchema = z.object({
  items: z.array(commentSchema),
  nextCursor: z.string().nullable(),
  /** Comentários não removidos; só na primeira página. */
  count: z.int().optional(),
  actions: z.object({ comment: z.boolean() }),
});
export type CommentPage = z.infer<typeof commentPageSchema>;

export const mentionCandidateSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.string(),
});
export type MentionCandidate = z.infer<typeof mentionCandidateSchema>;

export const mentionCandidatePageSchema = z.object({
  items: z.array(mentionCandidateSchema),
  nextCursor: z.string().nullable(),
});
export type MentionCandidatePage = z.infer<typeof mentionCandidatePageSchema>;
