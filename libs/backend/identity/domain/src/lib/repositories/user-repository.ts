import type { EmailAddress } from '@taskflow/backend/shared/kernel';
import type { User } from '../user/user';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: EmailAddress): Promise<User | null>;
  /** Ids inexistentes são ignorados; a ordem do resultado não é garantida. */
  findByIds(ids: readonly string[]): Promise<User[]>;
  /** Lança `EmailAlreadyRegisteredError` se o e-mail já existir (inclusive por corrida). */
  add(user: User): Promise<void>;
  /** Optimistic locking: lança `VersionConflictError` se a versão lida estiver desatualizada. */
  save(user: User): Promise<void>;
}
