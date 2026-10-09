import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { EmailAddress } from '@taskflow/backend/shared/kernel';
import { SmtpEmailSender } from './smtp-email-sender';

type MailpitMessage = { Subject: string; To: Array<{ Address: string }> };

describe('SmtpEmailSender (integration with Mailpit)', () => {
  let mailpit: StartedTestContainer;
  const senders: SmtpEmailSender[] = [];

  const mailpitApi = () => `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}/api/v1`;

  beforeAll(async () => {
    mailpit = await new GenericContainer('axllent/mailpit:v1.31')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forHttp('/readyz', 8025))
      .start();
  });

  afterAll(async () => {
    senders.forEach((sender) => sender.close());
    await mailpit?.stop();
  });

  function sender(smtpUrl: string) {
    const instance = new SmtpEmailSender({
      smtpUrl,
      from: 'TaskFlow <nao-responda@taskflow.local>',
    });
    senders.push(instance);
    return instance;
  }

  it('delivers text and HTML versions to the recipient', async () => {
    const smtpUrl = `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`;

    await sender(smtpUrl).send({
      to: EmailAddress.create('Ana@Exemplo.com'),
      subject: 'Confirme seu e-mail',
      text: 'Acesse o link para confirmar.',
      html: '<p>Acesse o link para confirmar.</p>',
    });

    const response = await fetch(`${mailpitApi()}/messages`);
    const body = (await response.json()) as { messages: MailpitMessage[] };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      Subject: 'Confirme seu e-mail',
      To: [{ Address: 'ana@exemplo.com' }],
    });
  });

  it('rejects when the SMTP server is unreachable, allowing the job to retry', async () => {
    await expect(
      sender('smtp://127.0.0.1:1').send({
        to: EmailAddress.create('ana@exemplo.com'),
        subject: 'x',
        text: 'x',
        html: '<p>x</p>',
      }),
    ).rejects.toThrow();
  });

  it('T29/B4: refuses to send in clear text when TLS is required (server without STARTTLS)', async () => {
    const smtpUrl = `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`;
    const strict = new SmtpEmailSender({
      smtpUrl,
      from: 'TaskFlow <nao-responda@taskflow.local>',
      requireTls: true,
    });
    senders.push(strict);

    await expect(
      strict.send({
        to: EmailAddress.create('ana@exemplo.com'),
        subject: 'Link secreto',
        text: 'x',
        html: '<p>x</p>',
      }),
    ).rejects.toThrow();
    const response = await fetch(`${mailpitApi()}/messages`);
    const body = (await response.json()) as { messages: MailpitMessage[] };
    expect(body.messages.some((message) => message.Subject === 'Link secreto')).toBe(false);
  });

  it('refuses non-SMTP URLs at construction time', () => {
    expect(() => sender('http://localhost:1025')).toThrow('smtp: or smtps:');
  });
});
