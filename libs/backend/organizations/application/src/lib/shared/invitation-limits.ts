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
  /**
   * Por (organização, destinatário pseudonimizado), supressão silenciosa (rev. 4, achado M1):
   * uma organização não esgota a cota de um e-mail para as outras.
   */
  perOrganizationRecipient: [
    {
      name: 'organizations.invitations.organization-recipient.day',
      points: 3,
      durationSeconds: DAY,
    },
    {
      name: 'organizations.invitations.organization-recipient.week',
      points: 10,
      durationSeconds: WEEK,
    },
  ],
  /** Teto global por destinatário, somando organizações: contra spam em massa (silencioso). */
  perRecipientGlobal: [
    { name: 'organizations.invitations.recipient-global.day', points: 20, durationSeconds: DAY },
  ],
} as const satisfies Record<string, RateLimitPolicy | ReadonlyArray<RateLimitPolicy>>;
