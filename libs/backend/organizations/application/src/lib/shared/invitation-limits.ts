import type { RateLimitPolicy } from '@taskflow/backend/shared/application';

const TEN_MINUTES = 10 * 60;
const DAY = 24 * 60 * 60;
const WEEK = 7 * DAY;

/**
 * RNF-04 (design, "Abuso de e-mail"). Os três primeiros respondem 429 com `Retry-After`; o limite
 * por destinatário suprime o e-mail em silêncio (a resposta não muda).
 */
export const INVITATION_POLICIES = {
  /** Convites criados ou reenviados por uma conta, somando organizações. */
  perAccount: { name: 'organizations.invitations.account.day', points: 30, durationSeconds: DAY },
  perOrganization: {
    name: 'organizations.invitations.organization.day',
    points: 50,
    durationSeconds: DAY,
  },
  /** Vale para convidar, reconvidar, reenviar e revogar+recriar o mesmo e-mail. */
  perOrganizationEmail: {
    name: 'organizations.invitations.organization-email.10min',
    points: 1,
    durationSeconds: TEN_MINUTES,
  },
  /** Por destinatário pseudonimizado, somando organizações (supressão silenciosa). */
  perRecipient: [
    { name: 'organizations.invitations.recipient.day', points: 3, durationSeconds: DAY },
    { name: 'organizations.invitations.recipient.week', points: 10, durationSeconds: WEEK },
  ],
} as const satisfies Record<string, RateLimitPolicy | ReadonlyArray<RateLimitPolicy>>;
