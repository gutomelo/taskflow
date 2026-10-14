import { z } from 'zod';
import { statusCategorySchema } from '../projects/projects.contract';
import { taskSummarySchema } from './tasks.contract';

/**
 * Contratos HTTP do quadro Kanban (spec 005). O quadro é uma visão de `tasks` (ADR 0016); a
 * posição do card é calculada só no servidor — o cliente informa o vizinho, nunca a chave.
 */
export const boardQuerySchema = z.object({
  projectId: z.uuid(),
  /** Cards por coluna na carga do quadro (padrão 25, máximo 50). */
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

export const columnQuerySchema = z.object({
  projectId: z.uuid(),
  cursor: z.string().min(1).max(512).optional(),
  /** Padrão 50, máximo 100. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const columnParamSchema = z.object({ statusId: z.uuid() });

export const cardSchema = taskSummarySchema.extend({
  /** Subtarefas sem as canceladas. */
  subtasks: z.object({ done: z.int(), total: z.int() }),
});
export type Card = z.infer<typeof cardSchema>;

export const boardSchema = z.object({
  statuses: z.array(
    z.object({ id: z.uuid(), name: z.string(), category: statusCategorySchema, position: z.int() }),
  ),
  transitions: z.array(z.object({ fromStatusId: z.uuid(), toStatusId: z.uuid() })),
  columns: z.array(
    z.object({ statusId: z.uuid(), cards: z.array(cardSchema), nextCursor: z.string().nullable() }),
  ),
  /** Capacidades do usuário no quadro (dica de interface; a API decide). */
  actions: z.object({ move: z.boolean(), configure: z.boolean() }),
});
export type Board = z.infer<typeof boardSchema>;

export const columnPageSchema = z.object({
  cards: z.array(cardSchema),
  nextCursor: z.string().nullable(),
});
export type ColumnPage = z.infer<typeof columnPageSchema>;

/** Sem vizinho ⇒ fim da coluna; os dois juntos ⇒ 400. */
export const moveCardRequestSchema = z
  .strictObject({
    toStatusId: z.uuid(),
    afterTaskId: z.uuid().optional(),
    beforeTaskId: z.uuid().optional(),
    version: z.int().min(1),
  })
  .refine((value) => value.afterTaskId === undefined || value.beforeTaskId === undefined, {
    message: 'Informe só um vizinho (antes ou depois)',
    path: ['(body)'],
  });
export type MoveCardRequest = z.infer<typeof moveCardRequestSchema>;

export const moveCardResponseSchema = z.object({ card: cardSchema, statusId: z.uuid() });
export type MoveCardResponse = z.infer<typeof moveCardResponseSchema>;
