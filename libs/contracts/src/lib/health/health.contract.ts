import { z } from 'zod';

/**
 * Contratos públicos dos endpoints de saúde da API.
 * Expõem apenas nome e estado das dependências: mensagens de erro internas
 * nunca fazem parte da resposta.
 */
export const livenessReportSchema = z.object({
  status: z.literal('ok'),
});

export type LivenessReport = z.infer<typeof livenessReportSchema>;

export const dependencyStatusSchema = z.enum(['up', 'down']);

export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const dependencyCheckSchema = z.object({
  name: z.string().min(1),
  status: dependencyStatusSchema,
  latencyMs: z.number().int().nonnegative(),
});

export type DependencyCheck = z.infer<typeof dependencyCheckSchema>;

export const readinessReportSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.array(dependencyCheckSchema),
});

export type ReadinessReport = z.infer<typeof readinessReportSchema>;
