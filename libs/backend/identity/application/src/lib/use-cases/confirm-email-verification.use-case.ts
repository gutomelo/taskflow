import type { RequestContext, TransactionRunner } from '@taskflow/backend/shared/application';
import type { Clock } from '@taskflow/backend/shared/kernel';
import {
  EmailAlreadyVerifiedError,
  InvalidOrExpiredTokenError,
  SessionRevokedError,
  type SecretTokenGenerator,
  type UserRepository,
  type UserTokenRepository,
} from '@taskflow/backend/identity/domain';
import { TokenBelongsToAnotherAccountError } from '../shared/identity-errors';

export type ConfirmEmailVerificationCommand = Readonly<{ token: string }>;

export interface ConfirmEmailVerificationDependencies {
  readonly users: UserRepository;
  readonly userTokens: UserTokenRepository;
  readonly secretTokens: SecretTokenGenerator;
  readonly transactions: TransactionRunner;
  readonly clock: Clock;
}

/**
 * RF-03 / BR-017. Exige sessão da **mesma** conta dona do token: impede que a vítima,
 * ao clicar no link de uma conta criada por terceiro com o e-mail dela, confirme essa conta
 * (pré-sequestro). Ordem: já verificado ⇒ 409 (clique duplo); token de outra conta ⇒ 403
 * sem consumir; inválido/expirado ⇒ 400; senão consome e verifica atomicamente.
 */
export class ConfirmEmailVerificationUseCase {
  constructor(private readonly deps: ConfirmEmailVerificationDependencies) {}

  async execute(
    context: RequestContext,
    { token }: ConfirmEmailVerificationCommand,
  ): Promise<void> {
    const tokenHash = this.deps.secretTokens.hash(token);

    await this.deps.transactions.run(async () => {
      const now = this.deps.clock.now();
      const user = await this.deps.users.findById(context.actor.userId);
      if (!user) throw new SessionRevokedError();
      if (user.isEmailVerified) throw new EmailAlreadyVerifiedError();

      const owner = await this.deps.userTokens.findOwner(tokenHash, 'email_verification', now);
      if (owner && owner.userId !== user.id) throw new TokenBelongsToAnotherAccountError();

      // Consumo condicionado ao dono no mesmo UPDATE: sem janela entre checar e consumir.
      const consumed = await this.deps.userTokens.consume(tokenHash, 'email_verification', now, {
        userId: user.id,
      });
      if (!consumed) throw new InvalidOrExpiredTokenError();

      user.verifyEmail(now);
      await this.deps.users.save(user);
    });
  }
}
