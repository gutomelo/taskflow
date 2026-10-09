import type { Pseudonymizer, RateLimiter } from '@taskflow/backend/shared/application';
import type { EmailAddress } from '@taskflow/backend/shared/kernel';
import { EMAIL_DELIVERY_POLICIES } from './rate-limit-policies';

/**
 * Decide se um e-mail transacional pode ser enviado ao endereço (chave pseudonimizada).
 * Consome as políticas em ordem e para na primeira negada, sem gastar as demais.
 */
export class EmailDeliveryThrottle {
  constructor(
    private readonly rateLimiter: RateLimiter,
    private readonly pseudonymizer: Pseudonymizer,
  ) {}

  async allow(email: EmailAddress): Promise<boolean> {
    const key = `email:${this.pseudonymizer.pseudonymize(email.value)}`;
    for (const policy of EMAIL_DELIVERY_POLICIES) {
      if (!(await this.rateLimiter.consume(policy, key)).allowed) return false;
    }
    return true;
  }
}
