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

  it('renders a list of links in both versions, escaping labels and hrefs', () => {
    const message = renderEmail(
      { email: EmailAddress.create('ana@exemplo.com'), name: null },
      'Assunto',
      [
        {
          kind: 'links',
          items: [
            { label: 'WEB-1', href: 'https://app.taskflow.dev/a' },
            { label: '<i>x</i>', href: 'https://app.taskflow.dev/b?"q' },
          ],
        },
      ],
    );

    expect(message.text).toContain(
      '- WEB-1: https://app.taskflow.dev/a\n- <i>x</i>: https://app.taskflow.dev/b?"q',
    );
    expect(message.html).toContain(
      '<li><a href="https://app.taskflow.dev/a" style="color:#1d4ed8">WEB-1</a></li>',
    );
    expect(message.html).toContain('href="https://app.taskflow.dev/b?&quot;q"');
    expect(message.html).toContain('&lt;i&gt;x&lt;/i&gt;');
    expect(message.html).not.toContain('<i>');
  });
});
