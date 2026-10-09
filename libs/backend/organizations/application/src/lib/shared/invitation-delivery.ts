import {
  createIntegrationEvent,
  RateLimitedError,
  type OutboxWriter,
  type Pseudonymizer,
  type RateLimiter,
  type RateLimitPolicy,
} from '@taskflow/backend/shared/application';
import type { Clock, EmailAddress, IdGenerator } from '@taskflow/backend/shared/kernel';
import { INVITATION_POLICIES } from './invitation-limits';
import { OrganizationsEventType } from './organizations-events';

export interface InvitationDeliveryDependencies {
  readonly rateLimiter: RateLimiter;
  readonly pseudonymizer: Pseudonymizer;
  readonly outbox: OutboxWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
}

/** Limites e agendamento do e-mail de convite, compartilhados por convidar e reenviar. */
export class InvitationDelivery {
  constructor(private readonly deps: InvitationDeliveryDependencies) {}

  /** 429 por conta e por organização: antes de travar, para não segurar o lock à toa. */
  async consumeSenderLimits(actorUserId: string, organizationId: string): Promise<void> {
    await this.require(INVITATION_POLICIES.perAccount, actorUserId);
    await this.require(INVITATION_POLICIES.perOrganization, organizationId);
  }

  /** 429 por (organização, e-mail), só depois das validações: um erro de entrada não o gasta. */
  consumeOrganizationEmailLimit(organizationId: string, email: EmailAddress): Promise<void> {
    return this.require(
      INVITATION_POLICIES.perOrganizationEmail,
      `${organizationId}:${this.deps.pseudonymizer.pseudonymize(email.value)}`,
    );
  }

  /**
   * Novo envio: o id do evento vira o `delivery_event_id` do convite. Com o destinatário acima
   * do limite, o evento não entra na outbox — o convite muda de envio mesmo assim (o link
   * anterior deixa de valer) e a resposta não revela a supressão.
   */
  async schedule(invitationId: string, email: EmailAddress): Promise<{ deliveryEventId: string }> {
    const event = createIntegrationEvent(
      OrganizationsEventType.invitationRequested,
      { invitationId },
      this.deps,
    );
    if (await this.recipientAllowed(email)) {
      await this.deps.outbox.append([event]);
    }
    return { deliveryEventId: event.id };
  }

  private async recipientAllowed(email: EmailAddress): Promise<boolean> {
    const key = this.deps.pseudonymizer.pseudonymize(email.value);
    for (const policy of INVITATION_POLICIES.perRecipient) {
      if (!(await this.deps.rateLimiter.consume(policy, key)).allowed) return false;
    }
    return true;
  }

  private async require(policy: RateLimitPolicy, key: string): Promise<void> {
    const decision = await this.deps.rateLimiter.consume(policy, key);
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
  }
}
