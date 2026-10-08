/** Gera identificadores de entidades (UUID v7 na implementação de infraestrutura). */
export interface IdGenerator {
  generate(): string;
}
