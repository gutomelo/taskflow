import type { EmailAddress } from '@taskflow/backend/shared/kernel';
import type { UserRepository } from '@taskflow/backend/identity/domain';

/** Teto por consulta: quem chama pagina (lista de membros, convites) antes de pedir as contas. */
export const MAX_ACCOUNTS_PER_QUERY = 100;

/** Dados de conta que outros contextos podem exibir; nunca hash de senha, versão ou datas internas. */
export interface UserAccountView {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
}

/**
 * Consulta para outros contextos (spec 002): o composition root liga a porta `UserDirectory`
 * de `organizations` a esta consulta. Ids inexistentes ficam fora do resultado.
 */
export class GetUserAccountsUseCase {
  constructor(private readonly deps: { readonly users: UserRepository }) {}

  async execute(userIds: readonly string[]): Promise<UserAccountView[]> {
    const unique = [...new Set(userIds)];
    if (unique.length > MAX_ACCOUNTS_PER_QUERY) {
      // Erro de programação de quem chama (página maior que o teto), não entrada do usuário.
      throw new RangeError(`At most ${MAX_ACCOUNTS_PER_QUERY} accounts per query`);
    }
    const users = await this.deps.users.findByIds(unique);
    return users.map((user) => ({
      id: user.id,
      name: user.name.value,
      email: user.email.value,
      emailVerified: user.isEmailVerified,
    }));
  }
}

/** Consulta para convites (spec 002): `null` quando não há conta com o e-mail. */
export class FindUserIdByEmailUseCase {
  constructor(private readonly deps: { readonly users: UserRepository }) {}

  async execute(email: EmailAddress): Promise<string | null> {
    const user = await this.deps.users.findByEmail(email);
    return user?.id ?? null;
  }
}
