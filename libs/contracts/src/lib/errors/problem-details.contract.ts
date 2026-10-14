import { z } from 'zod';

/**
 * Formato padronizado de erro da API, baseado na RFC 9457 (Problem Details for HTTP APIs).
 * `code` é um identificador estável e legível por máquina; `detail` é texto para humanos
 * e nunca deve conter stack traces, SQL ou dados de outros tenants.
 */
export const fieldViolationSchema = z.object({
  field: z.string(),
  message: z.string(),
});

export type FieldViolation = z.infer<typeof fieldViolationSchema>;

export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  code: z.string(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  violations: z.array(fieldViolationSchema).optional(),
  /**
   * Membro de extensão (RFC 9457) da spec 004: tarefas que impedem a operação — subtarefas
   * obrigatórias pendentes (BR-001) ou bloqueadoras pendentes (BR-006). Só ids do mesmo projeto.
   */
  taskIds: z.array(z.string()).optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
