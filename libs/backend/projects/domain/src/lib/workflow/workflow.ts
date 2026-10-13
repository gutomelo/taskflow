export const STATUS_CATEGORIES = ['todo', 'in_progress', 'done'] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export type WorkflowStatus = Readonly<{
  id: string;
  /** Dado do projeto (a spec 005 permitirá renomear); a categoria é o vocabulário estável. */
  name: string;
  category: StatusCategory;
  position: number;
}>;

export type WorkflowTransition = Readonly<{ fromStatusId: string; toStatusId: string }>;

export type Workflow = Readonly<{
  statuses: ReadonlyArray<WorkflowStatus>;
  transitions: ReadonlyArray<WorkflowTransition>;
}>;

/**
 * Workflow padrão criado com o projeto (BR-004): "A fazer" → "Em andamento" → "Concluído", com
 * volta entre vizinhos. Só leitura nesta spec; a configuração nasce na spec 005.
 */
export function defaultWorkflow(generateId: () => string): Workflow {
  const [todo, inProgress, done] = [
    { id: generateId(), name: 'A fazer', category: 'todo', position: 0 },
    { id: generateId(), name: 'Em andamento', category: 'in_progress', position: 1 },
    { id: generateId(), name: 'Concluído', category: 'done', position: 2 },
  ] as const satisfies ReadonlyArray<WorkflowStatus>;
  return {
    statuses: [todo, inProgress, done],
    transitions: [
      { fromStatusId: todo.id, toStatusId: inProgress.id },
      { fromStatusId: inProgress.id, toStatusId: todo.id },
      { fromStatusId: inProgress.id, toStatusId: done.id },
      { fromStatusId: done.id, toStatusId: inProgress.id },
    ],
  };
}
