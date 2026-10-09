import type {
  Pseudonymizer,
  RateLimiter,
  RateLimitPolicy,
} from '@taskflow/backend/shared/application';
import type { EmailAddress } from '@taskflow/backend/shared/kernel';
import { networkPrefix, type ClientInfo } from './client-info';
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

  /** Cadastro e reenvio do link de verificação. */
  allowVerification(email: EmailAddress): Promise<boolean> {
    return this.consume(
      EMAIL_DELIVERY_POLICIES.verification,
      `email:verification:${this.key(email)}`,
    );
  }

  /**
   * Recuperação de senha: limite por endereço e rede de origem (IPv4 /24, IPv6 /64) e teto
   * global por endereço. Um único atacante não consegue mais esgotar a recuperação da vítima.
   */
  async allowPasswordReset(email: EmailAddress, client: ClientInfo): Promise<boolean> {
    const key = this.key(email);
    const source = (client.ipAddress && networkPrefix(client.ipAddress)) ?? 'unknown';
    return (
      (await this.consume(
        EMAIL_DELIVERY_POLICIES.passwordResetBySource,
        `email:reset:${key}:${source}`,
      )) && (await this.consume(EMAIL_DELIVERY_POLICIES.passwordResetGlobal, `email:reset:${key}`))
    );
  }

  private key(email: EmailAddress): string {
    return this.pseudonymizer.pseudonymize(email.value);
  }

  private async consume(policies: ReadonlyArray<RateLimitPolicy>, key: string): Promise<boolean> {
    for (const policy of policies) {
      if (!(await this.rateLimiter.consume(policy, key)).allowed) return false;
    }
    return true;
  }
}
