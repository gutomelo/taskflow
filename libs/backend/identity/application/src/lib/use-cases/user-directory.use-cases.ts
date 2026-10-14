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

/** Teto de ids entre os quais se busca (spec 010: leitores de um projeto). */
export const MAX_SEARCH_IDS = 1000;
export const MAX_SEARCH_PAGE = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function encodePosition(name: string, id: string): string {
  return Buffer.from(JSON.stringify({ n: name, i: id }), 'utf8').toString('base64url');
}

/** Cursor inválido ⇒ `null` (recomeça): a busca já é restrita aos `ids` de quem chama. */
function decodePosition(cursor: string | null): Readonly<{ name: string; id: string }> | null {
  if (!cursor) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null || !('n' in value) || !('i' in value))
      return null;
    const { n, i } = value;
    // `id` vai para uma comparação em coluna UUID: fora do formato seria 500 (B1 da auditoria).
    return typeof n === 'string' && typeof i === 'string' && n.length <= 200 && UUID.test(i)
      ? { name: n, id: i }
      : null;
  } catch {
    return null;
  }
}

/**
 * Busca de pessoas **entre ids dados** (spec 010, candidatos a menção): nome ou e-mail contendo o
 * texto, por `(name, id)`, com cursor opaco. Quem decide quais ids valem é o chamador.
 */
export class SearchUsersAmongUseCase {
  constructor(private readonly deps: { readonly users: UserRepository }) {}

  async execute(
    userIds: readonly string[],
    query: string,
    page: Readonly<{ limit: number; cursor: string | null }>,
  ): Promise<Readonly<{ items: UserAccountView[]; nextCursor: string | null }>> {
    const unique = [...new Set(userIds)];
    if (unique.length > MAX_SEARCH_IDS) {
      // Erro de programação de quem chama (o teto é conferido antes), não entrada do usuário.
      throw new RangeError(`At most ${MAX_SEARCH_IDS} ids per search`);
    }
    const limit = Math.min(Math.max(page.limit, 1), MAX_SEARCH_PAGE);
    const users = await this.deps.users.searchAmong(
      unique,
      query,
      limit + 1,
      decodePosition(page.cursor),
    );
    const items = users.slice(0, limit);
    const last = items.at(-1);
    return {
      items: items.map((user) => ({
        id: user.id,
        name: user.name.value,
        email: user.email.value,
        emailVerified: user.isEmailVerified,
      })),
      nextCursor: users.length > limit && last ? encodePosition(last.name.value, last.id) : null,
    };
  }
}
