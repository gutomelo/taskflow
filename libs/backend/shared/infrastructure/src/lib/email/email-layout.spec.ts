import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { escapeHtml, renderEmail } from './email-layout';

describe('transactional email layout', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('renders text and HTML from the same blocks, escaping every dynamic value', () => {
    const message = renderEmail(
      { email: EmailAddress.create('ana@exemplo.com'), name: null },
      'Assunto',
      [
        { kind: 'paragraph', text: 'Texto <b>' },
        { kind: 'action', label: 'Abrir', href: 'https://app.taskflow.dev/x#token=a' },
      ],
    );

    expect(message.text).toContain('Olá!');
    expect(message.text).toContain('Abrir: https://app.taskflow.dev/x#token=a');
    expect(message.html).toContain('Texto &lt;b&gt;');
    expect(message.html).not.toContain('<b>');
  });
});
