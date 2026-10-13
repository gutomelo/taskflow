/** Listas por cursor (api-design): 25 itens por padrão e no máximo 100. Usado por todo contexto. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export type PageQuery = Readonly<{ limit?: number; cursor?: string | null }>;

/** A camada HTTP valida; aqui só se garante o intervalo para nenhum chamador escapar do teto. */
export function toPageRequest(query: PageQuery): { limit: number; cursor: string | null } {
  const limit = Math.trunc(query.limit ?? DEFAULT_PAGE_SIZE);
  return {
    limit: Math.min(Math.max(Number.isFinite(limit) ? limit : DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE),
    cursor: query.cursor ?? null,
  };
}
