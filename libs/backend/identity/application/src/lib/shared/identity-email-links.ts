import type { User } from '@taskflow/backend/identity/domain';
import type { IdentityEmailRecipient } from '../ports/identity-email-templates';

/** Resultado do envio, para log do worker (nunca contém e-mail nem token). */
export type EmailDeliveryOutcome =
  | Readonly<{ status: 'sent' }>
  | Readonly<{
      status: 'discarded';
      reason:
        | 'user_not_found'
        | 'email_already_verified'
        | 'token_already_used'
        | 'invalid_email'
        | 'superseded';
    }>;

export const SENT: EmailDeliveryOutcome = { status: 'sent' };

export function discarded(
  reason: Extract<EmailDeliveryOutcome, { status: 'discarded' }>['reason'],
): EmailDeliveryOutcome {
  return { status: 'discarded', reason };
}

/** Link da SPA (`appUrl` é só a origem, validada na configuração). */
export function appLink(appUrl: string, path: string): string {
  return new URL(path, appUrl).toString();
}

/**
 * Token no fragmento: não chega ao servidor, a logs de proxy nem ao `Referer` (design da spec
 * 001). O SPA lê, limpa a URL e só envia o token após clique explícito.
 */
export function tokenLink(appUrl: string, path: string, token: string): string {
  return `${appLink(appUrl, path)}#token=${encodeURIComponent(token)}`;
}

export function recipientOf(user: User): IdentityEmailRecipient {
  return { email: user.email, name: user.isEmailVerified ? user.name.value : null };
}
