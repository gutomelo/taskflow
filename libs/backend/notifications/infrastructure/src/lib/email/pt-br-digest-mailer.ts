import type { DigestEmail, DigestMailer } from '@taskflow/backend/notifications/application';
import type { EmailMessage, EmailSender } from '@taskflow/backend/shared/application';
import { renderEmail, type EmailBlock } from '@taskflow/backend/shared/infrastructure';
import { EmailAddress } from '@taskflow/backend/shared/kernel';

/** Assunto fixo (decisão 8): nada que um terceiro escolha aparece fora do corpo. */
export const DIGEST_SUBJECT = 'Você tem novidades no TaskFlow';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function summary(group: DigestEmail['groups'][number]): string {
  const parts = [
    ...(group.mentions > 0 ? [plural(group.mentions, 'menção', 'menções')] : []),
    ...(group.assignments > 0 ? [plural(group.assignments, 'atribuição', 'atribuições')] : []),
  ];
  return `Na organização ${group.organizationSlug}: ${parts.join(' e ')}.`;
}

/**
 * Resumo em pt-BR (BR-034, decisões 7 e 8). Saudação genérica e nenhum nome de pessoa, título,
 * texto de comentário nem nome de organização: só o slug (formato restrito), contagens, chaves de
 * tarefa e links do próprio app. Todo valor passa pelo escape do layout.
 */
export function renderDigestEmail(to: string, digest: DigestEmail): EmailMessage {
  const blocks: EmailBlock[] = [
    { kind: 'paragraph', text: 'Desde o último resumo, você recebeu notificações no TaskFlow.' },
  ];
  for (const group of digest.groups) {
    blocks.push({ kind: 'paragraph', text: summary(group) });
    blocks.push({
      kind: 'links',
      items: group.tasks.map((task) => ({ label: task.key, href: task.url })),
    });
  }
  blocks.push({
    kind: 'paragraph',
    text: 'Para não receber mais este resumo, desligue-o nas preferências da sua conta:',
  });
  blocks.push({ kind: 'action', label: 'Preferências da conta', href: digest.preferencesUrl });
  return renderEmail({ email: EmailAddress.create(to), name: null }, DIGEST_SUBJECT, blocks);
}

/** `DigestMailer` sobre o `EmailSender` compartilhado (SMTP); falha propaga para o retry do job. */
export class PtBrDigestMailer implements DigestMailer {
  constructor(private readonly emailSender: EmailSender) {}

  send(to: Readonly<{ email: string; name: string }>, digest: DigestEmail): Promise<void> {
    return this.emailSender.send(renderDigestEmail(to.email, digest));
  }
}
