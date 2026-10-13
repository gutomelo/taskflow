import type { DomainErrorMapping } from '@taskflow/backend/shared/http';

type Mappings = Readonly<Record<string, DomainErrorMapping>>;

/**
 * Junta os mapas `code → HTTP` dos contextos. Contextos podem reutilizar um código de propósito
 * (ex.: `MEMBER_NOT_FOUND` em `organizations` e `projects`, design da spec 003), mas com o mesmo
 * status e título: um spread silencioso deixaria o último mapa vencer. Divergência falha na
 * montagem, antes de qualquer requisição.
 */
export function mergeDomainErrors(...maps: ReadonlyArray<Mappings>): Mappings {
  const merged: Record<string, DomainErrorMapping> = {};
  for (const map of maps) {
    for (const [code, mapping] of Object.entries(map)) {
      const existing = merged[code];
      if (existing && (existing.status !== mapping.status || existing.title !== mapping.title)) {
        throw new Error(`Conflicting HTTP mappings for domain error ${code}`);
      }
      merged[code] = mapping;
    }
  }
  return merged;
}
