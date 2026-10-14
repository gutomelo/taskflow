import type { EmailAddress } from '@taskflow/backend/shared/kernel';
import type { User } from '../user/user';

/** Posição na busca, na ordem `(name, id)`. */
export type UserSearchPosition = Readonly<{ name: string; id: string }>;

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: EmailAddress): Promise<User | null>;
  /** Ids inexistentes são ignorados; a ordem do resultado não é garantida. */
  findByIds(ids: readonly string[]): Promise<User[]>;
  /**
   * Só entre `ids` (spec 010): nome ou e-mail contendo `query` (sem diferenciar maiúsculas; `%` e
   * `_` são literais), na ordem `(name, id)`, até `limit` depois de `after`.
   */
  searchAmong(
    ids: readonly string[],
    query: string,
    limit: number,
    after: UserSearchPosition | null,
  ): Promise<User[]>;
  /** Lança `EmailAlreadyRegisteredError` se o e-mail já existir (inclusive por corrida). */
  add(user: User): Promise<void>;
  /** Optimistic locking: lança `VersionConflictError` se a versão lida estiver desatualizada. */
  save(user: User): Promise<void>;
}
