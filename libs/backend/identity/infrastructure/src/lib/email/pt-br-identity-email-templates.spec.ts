import { EmailAddress } from '@taskflow/backend/shared/kernel';
import type { IdentityEmailRecipient } from '@taskflow/backend/identity/application';
import { ptBrIdentityEmailTemplates as templates } from './pt-br-identity-email-templates';

const to = EmailAddress.create('ana@exemplo.com');
const named: IdentityEmailRecipient = { email: to, name: 'Ana <script>alert(1)</script> & Cia' };
const anonymous: IdentityEmailRecipient = { email: to, name: null };
const verifyLink = 'https://app.taskflow.dev/verify-email#token=abc_DEF-123';

describe('ptBrIdentityEmailTemplates', () => {
  it('renders the verification email with link, validity and text/HTML versions', () => {
    const message = templates.emailVerification({
      recipient: anonymous,
      link: verifyLink,
      validForHours: 24,
    });

    expect(message.to).toBe(to);
    expect(message.subject).toBe('Confirme seu e-mail no TaskFlow');
    expect(message.text).toContain('Olá!');
    expect(message.text).toContain(`Confirmar e-mail: ${verifyLink}`);
    expect(message.text).toContain('24 horas');
    expect(message.html).toContain(`href="${verifyLink}"`);
    expect(message.html).toContain('<html lang="pt-BR">');
  });

  it('escapes the recipient name in HTML and never puts it in the subject', () => {
    const message = templates.passwordReset({
      recipient: named,
      link: 'https://app.taskflow.dev/reset-password#token=t',
      validForMinutes: 30,
    });

    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('Olá, Ana &lt;script&gt;alert(1)&lt;/script&gt; &amp; Cia!');
    expect(message.subject).toBe('Redefina sua senha do TaskFlow');
    expect(message.text).toContain('30 minutos');
  });

  it('escapes links used as attributes', () => {
    const message = templates.passwordChanged({
      recipient: anonymous,
      forgotPasswordLink: 'https://app.taskflow.dev/forgot-password?a="><img src=x>',
    });

    expect(message.html).not.toContain('"><img');
    expect(message.html).toContain(
      'href="https://app.taskflow.dev/forgot-password?a=&quot;&gt;&lt;img src=x&gt;"',
    );
  });

  it('informs about the existing account without any verification or reset token (BR-014)', () => {
    const message = templates.accountAlreadyExists({
      recipient: named,
      loginLink: 'https://app.taskflow.dev/login',
      forgotPasswordLink: 'https://app.taskflow.dev/forgot-password',
    });

    expect(message.subject).toBe('Tentativa de cadastro com o seu e-mail');
    expect(`${message.text}${message.html}`).not.toContain('token');
    expect(message.text).toContain('https://app.taskflow.dev/login');
    expect(message.text).toContain('https://app.taskflow.dev/forgot-password');
  });
});
