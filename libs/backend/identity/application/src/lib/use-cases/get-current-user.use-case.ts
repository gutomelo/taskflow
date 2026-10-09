import type { RequestContext } from '@taskflow/backend/shared/application';
import { SessionRevokedError, type UserRepository } from '@taskflow/backend/identity/domain';
import { toCurrentUserView, type CurrentUserView } from '../shared/current-user-view';

/** RF-12. Usuário removido (ex.: limpeza de contas não verificadas) invalida a sessão. */
export class GetCurrentUserUseCase {
  constructor(private readonly deps: { readonly users: UserRepository }) {}

  async execute(context: RequestContext): Promise<CurrentUserView> {
    const user = await this.deps.users.findById(context.actor.userId);
    if (!user) {
      throw new SessionRevokedError();
    }
    return toCurrentUserView(user);
  }
}
