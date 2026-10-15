import { v7 as uuidv7 } from 'uuid';
import type { IdGenerator } from '@taskflow/backend/shared/kernel';

/**
 * UUID v7: ordenável por tempo (índices B-tree compactos) e não enumerável.
 * Revela o instante de criação com precisão de milissegundos — aceitável para os IDs do TaskFlow.
 */
export class UuidV7Generator implements IdGenerator {
  generate(): string {
    return uuidv7();
  }
}
