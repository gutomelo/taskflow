import {
  createIntegrationEvent,
  type OutboxWriter,
  type TransactionRunner,
} from '@taskflow/backend/shared/application';
import { EmailAddress, type Clock, type IdGenerator } from '@taskflow/backend/shared/kernel';
import type { EmailDeliveryThrottle } from '../shared/email-delivery-throttle';
import { IdentityEventType } from '../shared/identity-events';

export type RequestPasswordResetCommand = Readonly<{ email: string }>;

export interface RequestPasswordResetDependencies {
  readonly emailThrottle: EmailDeliveryThrottle;
  readonly transactions: TransactionRunner;
  readonly outbox: OutboxWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/**
 * RF-10 / BR-014. Trabalho constante: **não** consulta se a conta existe — sempre registra o
 * pedido (com o e-mail normalizado) e o worker descarta quando não houver conta. Assim tempo
 * e resposta são idênticos para e-mails cadastrados e não cadastrados.
 */
export class RequestPasswordResetUseCase {
  constructor(private readonly deps: RequestPasswordResetDependencies) {}

  async execute({ email: rawEmail }: RequestPasswordResetCommand): Promise<void> {
    const email = EmailAddress.create(rawEmail);
    if (!(await this.deps.emailThrottle.allow(email))) return;

    await this.deps.transactions.run(() =>
      this.deps.outbox.append([
        createIntegrationEvent(
          IdentityEventType.passwordResetRequested,
          { email: email.value },
          { idGenerator: this.deps.idGenerator, clock: this.deps.clock },
        ),
      ]),
    );
  }
}
