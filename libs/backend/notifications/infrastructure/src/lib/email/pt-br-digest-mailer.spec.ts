import type { DigestEmail } from '@taskflow/backend/notifications/application';
import type { EmailMessage } from '@taskflow/backend/shared/application';
import { DIGEST_SUBJECT, PtBrDigestMailer, renderDigestEmail } from './pt-br-digest-mailer';

const APP = 'https://app.taskflow.test';

const digest: DigestEmail = {
  groups: [
    {
      organizationSlug: 'acme',
      mentions: 1,
      assignments: 2,
      tasks: [
        { key: 'WEB-1', url: `${APP}/o/acme/projects/WEB/tasks/1` },
        { key: 'WEB-2', url: `${APP}/o/acme/projects/WEB/tasks/2` },
      ],
    },
    {
      organizationSlug: 'beta',
      mentions: 0,
      assignments: 1,
      tasks: [{ key: 'APP-9', url: `${APP}/o/beta/projects/APP/tasks/9` }],
    },
  ],
  preferencesUrl: `${APP}/account/notifications`,
};

describe('pt-BR digest email (BR-034, decisions 7 and 8)', () => {
  it('fixed subject, generic greeting, counts per slug, task keys as links and the opt-out', () => {
    const message = renderDigestEmail('Bia@Exemplo.com', digest);

    expect(message.to.value).toBe('bia@exemplo.com');
    expect(message.subject).toBe(DIGEST_SUBJECT);
    expect(message.text.startsWith('Olá!')).toBe(true);
    expect(message.text).toContain('Na organização acme: 1 menção e 2 atribuições.');
    expect(message.text).toContain('Na organização beta: 1 atribuição.');
    expect(message.text).toContain(`- WEB-2: ${APP}/o/acme/projects/WEB/tasks/2`);
    expect(message.text).toContain(`Preferências da conta: ${APP}/account/notifications`);
    expect(message.html.match(/href="/g)).toHaveLength(4);
  });

  it('hostile values never become markup nor change the subject', () => {
    const message = renderDigestEmail('bia@exemplo.com', {
      groups: [
        {
          organizationSlug: '<script>alert(1)</script>',
          mentions: 2,
          assignments: 0,
          tasks: [{ key: '"><img src=x onerror=alert(1)>', url: 'https://evil.example/"x' }],
        },
      ],
      preferencesUrl: `${APP}/account/notifications`,
    });

    expect(message.subject).toBe(DIGEST_SUBJECT);
    expect(message.html).not.toMatch(/<script|<img/);
    expect(message.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(message.html).toContain('href="https://evil.example/&quot;x"');
    expect(message.html.match(/href="/g)).toHaveLength(2);
  });

  it('sends through the shared sender, ignoring the recipient name', async () => {
    const sent: EmailMessage[] = [];
    await new PtBrDigestMailer({ send: async (message) => void sent.push(message) }).send(
      { email: 'bia@exemplo.com', name: 'Bia <Admin>' },
      digest,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).not.toContain('Bia');
    expect(sent[0]?.html).not.toContain('Bia');
  });
});
