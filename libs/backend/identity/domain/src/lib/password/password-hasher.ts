import type { Password } from './password';

/** Hash de senha (Argon2id na infraestrutura — tarefa T11). Operações lentas por design. */
export interface PasswordHasher {
  hash(password: Password): Promise<string>;
  /**
   * Compara uma senha candidata (sem aplicar BR-011: senhas antigas continuam válidas
   * para login) com o hash armazenado, em tempo constante.
   */
  verify(passwordHash: string, candidate: string): Promise<boolean>;
  /** Indica que o hash usa parâmetros desatualizados e deve ser refeito no próximo login. */
  needsRehash(passwordHash: string): boolean;
}
