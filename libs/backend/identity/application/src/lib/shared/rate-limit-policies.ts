import type { RateLimitPolicy } from '@taskflow/backend/shared/application';

const TEN_MINUTES = 10 * 60;
const DAY = 24 * 60 * 60;

/**
 * BR-014: limites de e-mails enviados a um mesmo endereço. Excedido, o envio é suprimido em
 * silêncio — a resposta ao cliente não muda.
 *
 * Orçamentos separados por finalidade (T29/M4): pedidos de recuperação feitos por terceiros não
 * esgotam os links de verificação, nem o contrário. Na recuperação, o limite apertado vale por
 * endereço **e** rede de origem; um teto global mais alto protege a caixa de entrada da vítima.
 */
export const EMAIL_DELIVERY_POLICIES = {
  verification: [
    { name: 'identity.email-delivery.verification.10min', points: 1, durationSeconds: TEN_MINUTES },
    { name: 'identity.email-delivery.verification.day', points: 5, durationSeconds: DAY },
  ],
  passwordResetBySource: [
    { name: 'identity.email-delivery.reset-source.10min', points: 1, durationSeconds: TEN_MINUTES },
    { name: 'identity.email-delivery.reset-source.day', points: 5, durationSeconds: DAY },
  ],
  passwordResetGlobal: [
    { name: 'identity.email-delivery.reset-global.day', points: 20, durationSeconds: DAY },
  ],
} as const satisfies Record<string, ReadonlyArray<RateLimitPolicy>>;
