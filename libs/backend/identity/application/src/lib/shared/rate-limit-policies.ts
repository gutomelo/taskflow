import type { RateLimitPolicy } from '@taskflow/backend/shared/application';

/**
 * BR-014 / M5 da revisão de segurança: limite de e-mails enviados a um mesmo endereço.
 * Excedido, o envio é suprimido em silêncio — a resposta ao cliente não muda.
 */
export const EMAIL_DELIVERY_POLICIES: ReadonlyArray<RateLimitPolicy> = [
  { name: 'identity.email-delivery.10min', points: 1, durationSeconds: 10 * 60 },
  { name: 'identity.email-delivery.day', points: 5, durationSeconds: 24 * 60 * 60 },
];
