import type { EmailMessage } from '@taskflow/backend/shared/application';
import type { EmailAddress } from '@taskflow/backend/shared/kernel';

/**
 * Destinatário de um e-mail transacional. `name` nulo ⇒ saudação genérica (ex.: conta não
 * verificada, convidado sem conta): nome escolhido por terceiros não entra no e-mail.
 */
export type EmailRecipient = Readonly<{ email: EmailAddress; name: string | null }>;

export type EmailBlock =
  | Readonly<{ kind: 'paragraph'; text: string }>
  | Readonly<{ kind: 'action'; label: string; href: string }>;

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapa texto e valores de atributo; todo dado dinâmico passa por aqui antes de virar HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

const FOOTER = 'Equipe TaskFlow · Este é um e-mail automático; não é preciso respondê-lo.';

/**
 * Layout compartilhado dos e-mails transacionais (`identity` e `organizations`).
 * Monta as versões texto e HTML a partir dos mesmos blocos, para que nunca divirjam.
 * O HTML é mínimo (estilos inline, sem imagens nem recursos externos).
 */
export function renderEmail(
  recipient: EmailRecipient,
  subject: string,
  blocks: ReadonlyArray<EmailBlock>,
): EmailMessage {
  const greeting = recipient.name ? `Olá, ${recipient.name}!` : 'Olá!';

  const text = [
    greeting,
    ...blocks.map((block) =>
      block.kind === 'paragraph' ? block.text : `${block.label}: ${block.href}`,
    ),
    `— ${FOOTER}`,
  ].join('\n\n');

  const body = blocks
    .map((block) =>
      block.kind === 'paragraph'
        ? `<p style="margin:0 0 16px">${escapeHtml(block.text)}</p>`
        : [
            `<p style="margin:0 0 16px"><a href="${escapeHtml(block.href)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600">${escapeHtml(block.label)}</a></p>`,
            `<p style="margin:0 0 16px;font-size:13px;color:#4b5563">Se o botão não funcionar, copie e cole este endereço no navegador:<br><span style="word-break:break-all">${escapeHtml(block.href)}</span></p>`,
          ].join(''),
    )
    .join('');

  const html = [
    '<!doctype html>',
    '<html lang="pt-BR"><head><meta charset="utf-8">',
    `<title>${escapeHtml(subject)}</title></head>`,
    '<body style="margin:0;padding:24px;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111827">',
    '<div style="max-width:560px;margin:0 auto;padding:24px;background:#ffffff;border-radius:8px">',
    `<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>`,
    body,
    `<p style="margin:24px 0 0;font-size:13px;color:#4b5563">${escapeHtml(FOOTER)}</p>`,
    '</div></body></html>',
  ].join('');

  return { to: recipient.email, subject, text, html };
}
