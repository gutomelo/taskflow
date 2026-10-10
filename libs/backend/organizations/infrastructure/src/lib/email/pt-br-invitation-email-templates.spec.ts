import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { ptBrInvitationEmailTemplates as templates } from './pt-br-invitation-email-templates';

const to = EmailAddress.create('bia@exemplo.com');
const link = 'https://app.taskflow.dev/invitations/accept#token=abc_DEF-123';

describe('ptBrInvitationEmailTemplates (RNF-08)', () => {
  it('quotes the names in a fixed sentence, with the warning and a single TaskFlow link', () => {
    const message = templates.invitation({
      to,
      organizationName: 'Acme',
      inviterName: 'Ana Souza',
      role: 'admin',
      link,
      validForDays: 7,
    });

    expect(message.to).toBe(to);
    expect(message.subject).toBe('Convite para a organização “Acme” no TaskFlow');
    // O destinatário ainda não é conhecido: saudação genérica, nunca o nome de outra pessoa.
    expect(message.text.startsWith('Olá!')).toBe(true);
    expect(message.text).toContain(
      '“Ana Souza” convidou você para a organização “Acme” no TaskFlow, com o papel de administrador(a).',
    );
    expect(message.text).toContain(`Ver convite: ${link}`);
    expect(message.text).toContain('7 dias');
    expect(message.text).toContain('Se você não esperava este convite, ignore este e-mail.');
    expect(message.html.match(/href="/g)).toHaveLength(1);
    expect(message.html).toContain(`href="${link}"`);
  });

  it('escapes names in HTML and never turns them into links', () => {
    const message = templates.invitation({
      to,
      organizationName: '<a href="https://evil.example">Clique</a>',
      inviterName: 'Suporte <b>TaskFlow</b>',
      role: 'member',
      link,
      validForDays: 7,
    });

    expect(message.html).not.toContain('evil.example">');
    expect(message.html).not.toContain('<b>');
    expect(message.html).toContain(
      '&lt;a href=&quot;https://evil.example&quot;&gt;Clique&lt;/a&gt;',
    );
    expect(message.html.match(/href="/g)).toHaveLength(1);
  });

  it('uses a nameless sentence when the inviter is unknown', () => {
    const message = templates.invitation({
      to,
      organizationName: 'Acme',
      inviterName: null,
      role: 'viewer',
      link,
      validForDays: 7,
    });

    expect(message.text).toContain(
      'Você foi convidado(a) para a organização “Acme” no TaskFlow, com o papel de leitor(a).',
    );
    expect(message.text).toContain('Olá!');
  });
});
