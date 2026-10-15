import { z } from 'zod';
import { pageQuerySchema } from '../organizations/organizations.contract';
import { projectRoleSchema, statusCategorySchema } from '../projects/projects.contract';

/**
 * Contratos HTTP de Tasks (spec 004). Formato na fronteira; regras (título, descrição, prazo,
 * BR-001/003/004/006/028/029) no domínio. Limites de tamanho folgados só contra payloads abusivos.
 */
export const taskPrioritySchema = z.enum(['none', 'low', 'medium', 'high', 'urgent']);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

const versionField = z.int().min(1);
const titleField = z.string().max(1000);
const descriptionField = z.string().max(40_000).nullable();
/** `YYYY-MM-DD`; data inexistente ou fora de 2000–2999 é recusada pelo domínio (`INVALID_DUE_DATE`). */
const dueDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .nullable();

/** BR-028: `CHAVE-N`. Malformada na rota responde 404 sem chegar ao banco. */
export const TASK_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}$/;

export const taskStatusSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: statusCategorySchema,
});

export const taskSummarySchema = z.object({
  id: z.uuid(),
  key: z.string(),
  number: z.int(),
  projectId: z.uuid(),
  title: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  /** `name` nulo só se a conta sumir de `identity`. */
  assignee: z.object({ userId: z.uuid(), name: z.string().nullable() }).nullable(),
  dueDate: z.string().nullable(),
  parentTaskId: z.uuid().nullable(),
  isRequired: z.boolean(),
  completedAt: z.iso.datetime().nullable(),
  canceledAt: z.iso.datetime().nullable(),
  version: z.int(),
});
export type TaskSummary = z.infer<typeof taskSummarySchema>;

/** Ações do usuário atual (dica de interface; a API sempre decide). */
export const taskActionsSchema = z.object({
  update: z.boolean(),
  assign: z.boolean(),
  cancel: z.boolean(),
  reopen: z.boolean(),
  delete: z.boolean(),
  /** Destinos permitidos pelo workflow (BR-004); BR-001/006 respondem 422 com os ids. */
  transitionTo: z.array(z.uuid()),
});
export type TaskActions = z.infer<typeof taskActionsSchema>;

export const taskSchema = taskSummarySchema.extend({
  description: z.string().nullable(),
  createdByUserId: z.uuid(),
  createdAt: z.iso.datetime(),
  actions: taskActionsSchema,
  subtasks: z.array(taskSummarySchema),
  blockedBy: z.array(taskSummarySchema),
  /** Até 50; `blockingTruncated` indica que há mais. */
  blocking: z.array(taskSummarySchema),
  blockingTruncated: z.boolean(),
});
export type TaskDto = z.infer<typeof taskSchema>;

export const taskPageSchema = z.object({
  items: z.array(taskSummarySchema),
  nextCursor: z.string().nullable(),
});
export type TaskPage = z.infer<typeof taskPageSchema>;

/** Sem `organizationId`, `number`, `statusId`, `completedAt` nem `createdByUserId`. */
export const createTaskRequestSchema = z.strictObject({
  projectId: z.uuid(),
  title: titleField,
  description: descriptionField.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeUserId: z.uuid().nullable().optional(),
  dueDate: dueDateField.optional(),
  parentTaskId: z.uuid().nullable().optional(),
  isRequired: z.boolean().optional(),
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/** Ao menos um campo, com a versão (BR-008). */
export const updateTaskRequestSchema = z
  .strictObject({
    title: titleField.optional(),
    description: descriptionField.optional(),
    priority: taskPrioritySchema.optional(),
    dueDate: dueDateField.optional(),
    isRequired: z.boolean().optional(),
    version: versionField,
  })
  .refine(
    ({ version: _version, ...fields }) =>
      Object.values(fields).some((value) => value !== undefined),
    { message: 'Informe ao menos um campo para alterar', path: ['(body)'] },
  );
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;

/** `null` desatribui (BR-003). */
export const assignTaskRequestSchema = z.strictObject({
  assigneeUserId: z.uuid().nullable(),
  version: versionField,
});
export type AssignTaskRequest = z.infer<typeof assignTaskRequestSchema>;

export const transitionTaskRequestSchema = z.strictObject({
  statusId: z.uuid(),
  version: versionField,
});
export type TransitionTaskRequest = z.infer<typeof transitionTaskRequestSchema>;

/** Cancelar e reabrir (BR-029, BR-008). */
export const taskVersionRequestSchema = z.strictObject({ version: versionField });
export type TaskVersionRequest = z.infer<typeof taskVersionRequestSchema>;

/** `DELETE /tasks/{taskId}?version` (BR-008). */
export const deleteTaskQuerySchema = z.object({ version: z.coerce.number().int().min(1) });

export const addDependencyRequestSchema = z.strictObject({ blockingTaskId: z.uuid() });
export type AddDependencyRequest = z.infer<typeof addDependencyRequestSchema>;

const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * RF-03. `assigneeUserId` é sempre um UUID; "eu" e "sem responsável" ficam em `assigned`
 * (achado M6.1: o filtro de pessoa nunca recebe palavras mágicas).
 */
export const taskListQuerySchema = pageQuerySchema.extend({
  projectId: z.uuid(),
  statusId: z.uuid().optional(),
  assigneeUserId: z.uuid().optional(),
  assigned: z.enum(['me', 'none']).optional(),
  priority: taskPrioritySchema.optional(),
  /** Inclui as canceladas (fora por padrão, BR-029). */
  canceled: booleanQuery.optional(),
  /** Subtarefas de uma tarefa; ausente = só primeiro nível. */
  parentTaskId: z.uuid().optional(),
});
export type TaskListQuery = z.input<typeof taskListQuerySchema>;

export const assignableUsersQuerySchema = pageQuerySchema.extend({ projectId: z.uuid() });

export const assignableUserSchema = z.object({
  userId: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  effectiveRole: projectRoleSchema,
});
export type AssignableUser = z.infer<typeof assignableUserSchema>;

export const assignableUserPageSchema = z.object({
  items: z.array(assignableUserSchema),
  nextCursor: z.string().nullable(),
});
export type AssignableUserPage = z.infer<typeof assignableUserPageSchema>;

export const taskIdParamSchema = z.object({ taskId: z.uuid() });
export const taskKeyParamSchema = z.object({ key: z.string().regex(TASK_KEY_PATTERN) });
export const taskDependencyParamSchema = z.object({
  taskId: z.uuid(),
  blockingTaskId: z.uuid(),
});
