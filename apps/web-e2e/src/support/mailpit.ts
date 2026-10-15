import { expect } from '@playwright/test';

// API do Mailpit (desenvolvimento: porta da UI em MAILPIT_UI_PORT; CI: serviço na 8025).
const MAILPIT_URL = process.env['MAILPIT_URL'] ?? 'http://localhost:58025';

type MailpitSummary = { ID: string; Subject: string; To: Array<{ Address: string }> };
export type MailpitMessage = MailpitSummary & { Text: string; HTML: string };

export async function messagesTo(address: string): Promise<MailpitMessage[]> {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=200`);
  const { messages } = (await response.json()) as { messages: MailpitSummary[] };
  const summaries = messages.filter((message) =>
    message.To.some((recipient) => recipient.Address === address),
  );
  return Promise.all(
    summaries.map(
      async (summary) =>
        (await (
          await fetch(`${MAILPIT_URL}/api/v1/message/${summary.ID}`)
        ).json()) as MailpitMessage,
    ),
  );
}

/**
 * Espera o worker entregar o e-mail (outbox → fila → SMTP) e devolve a mensagem. `matches` filtra
 * entre várias do mesmo assunto (ex.: um resumo horário que saiu antes do esperado).
 */
export async function waitForEmail(
  address: string,
  subject: string,
  matches: (message: MailpitMessage) => boolean = () => true,
): Promise<MailpitMessage> {
  let found: MailpitMessage | undefined;
  await expect
    .poll(
      async () => {
        found = (await messagesTo(address)).find(
          (message) => message.Subject === subject && matches(message),
        );
        return found !== undefined;
      },
      {
        message: `e-mail "${subject}" para ${address}`,
        timeout: 30_000,
        intervals: [250, 500, 1_000],
      },
    )
    .toBe(true);
  if (!found) throw new Error('unreachable');
  return found;
}

/** Primeiro link da aplicação no texto do e-mail que aponta para `path`. */
export function linkIn(message: MailpitMessage, path: string): string {
  const match = new RegExp(`https?://[^\\s]+${path}#token=[A-Za-z0-9_-]+`).exec(message.Text);
  if (!match) throw new Error(`No ${path} link in "${message.Subject}"`);
  return match[0];
}
