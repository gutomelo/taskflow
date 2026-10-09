import type { UserRepository } from '@taskflow/backend/identity/domain';

/**
 * Consulta para outros contextos (BR-013, spec 002): o composition root liga a porta
 * `EmailVerificationChecker` de `organizations` a esta consulta. `null` = usuário inexistente.
 */
export class GetUserVerificationStatusUseCase {
  constructor(private readonly deps: { readonly users: UserRepository }) {}

  async execute(userId: string): Promise<{ readonly emailVerified: boolean } | null> {
    const user = await this.deps.users.findById(userId);
    return user ? { emailVerified: user.isEmailVerified } : null;
  }
}
