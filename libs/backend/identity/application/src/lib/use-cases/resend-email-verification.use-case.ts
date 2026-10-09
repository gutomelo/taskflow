import {
  createIntegrationEvent,
  type OutboxWriter,
  type RequestContext,
  type TransactionRunner,
} from '@taskflow/backend/shared/application';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';
import {
  EmailAlreadyVerifiedError,
  SessionRevokedError,
  type UserRepository,
} from '@taskflow/backend/identity/domain';
import type { EmailDeliveryThrottle } from '../shared/email-delivery-throttle';
import { IdentityEventType } from '../shared/identity-events';

export interface ResendEmailVerificationDependencies {
  readonly users: UserRepository;
  readonly emailThrottle: EmailDeliveryThrottle;
  readonly transactions: TransactionRunner;
  readonly outbox: OutboxWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * RF-04. Excesso de pedidos é suprimido em silêncio pelo throttle por endereço (o limite por
 * usuário do endpoint fica na camada HTTP). Cada pedido gera um novo link; os anteriores
 * continuam válidos até expirar.
 */
export class ResendEmailVerificationUseCase {
  constructor(private readonly deps: ResendEmailVerificationDependencies) {}

  async execute(context: RequestContext): Promise<void> {
    const user = await this.deps.users.findById(context.actor.userId);
    if (!user) throw new SessionRevokedError();
    if (user.isEmailVerified) throw new EmailAlreadyVerifiedError();
    if (!(await this.deps.emailThrottle.allowVerification(user.email))) return;

    await this.deps.transactions.run(() =>
      this.deps.outbox.append([
        createIntegrationEvent(
          IdentityEventType.emailVerificationRequested,
          { userId: user.id },
          { idGenerator: this.deps.idGenerator, clock: this.deps.clock },
        ),
      ]),
    );
  }
}
