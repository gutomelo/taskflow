import type { DomainErrorMapping } from '@taskflow/backend/shared/http';

/**
 * Tradução dos códigos de `collaboration` para HTTP (design da spec 010). `TASK_NOT_FOUND`,
 * `TASK_CANCELED`, `PROJECT_ARCHIVED`, `INSUFFICIENT_ROLE`, `INVALID_CURSOR` e `VERSION_CONFLICT`
 * repetem status e título de `tasks` (teste de colisão em `apps/api`).
 */
export const collaborationErrorMappings: Readonly<Record<string, DomainErrorMapping>> = {
  INVALID_COMMENT_BODY: {
    status: 400,
    title: 'Comentário inválido: use de 1 a 5 000 caracteres de texto simples',
  },
  COMMENT_NOT_FOUND: { status: 404, title: 'Comentário não encontrado' },
  COMMENT_DELETED: { status: 409, title: 'O comentário foi removido' },
  TOO_MANY_MENTIONS: { status: 422, title: 'Mencione no máximo 20 pessoas por comentário' },
  INVALID_MENTION: {
    status: 422,
    title: 'Só é possível mencionar quem tem acesso ao projeto',
  },
  COMMENT_LIMIT_REACHED: { status: 422, title: 'Limite de comentários da tarefa atingido' },
  TOO_MANY_READERS: { status: 422, title: 'O projeto tem leitores demais para a busca' },
  TASK_NOT_FOUND: { status: 404, title: 'Tarefa não encontrada' },
  TASK_CANCELED: { status: 409, title: 'A tarefa está cancelada: reabra-a para alterar' },
  PROJECT_ARCHIVED: { status: 409, title: 'O projeto está arquivado' },
  INSUFFICIENT_ROLE: { status: 403, title: 'Seu papel não permite esta ação' },
  INVALID_CURSOR: { status: 400, title: 'Cursor inválido' },
  VERSION_CONFLICT: {
    status: 409,
    title: 'Os dados foram alterados por outra operação. Tente novamente.',
  },
};
