import { createTransport, type Transporter } from 'nodemailer';
import type { EmailMessage, EmailSender } from '@taskflow/backend/shared/application';

export interface SmtpEmailSenderOptions {
  /** `smtp://host:porta` (desenvolvimento) ou `smtps://usuario:senha@host:465`. */
  readonly smtpUrl: string;
  /** Remetente, ex.: `TaskFlow <nao-responda@taskflow.app>`. */
  readonly from: string;
}

/** Transporte SMTP genérico (ADR 0011). Falhas são lançadas para o job aplicar retry. */
export class SmtpEmailSender implements EmailSender {
  private readonly transporter: Transporter;

  constructor(private readonly options: SmtpEmailSenderOptions) {
    const url = new URL(options.smtpUrl);
    if (url.protocol !== 'smtp:' && url.protocol !== 'smtps:') {
      throw new Error('SMTP URL must use the smtp: or smtps: protocol');
    }
    const secure = url.protocol === 'smtps:';
    this.transporter = createTransport({
      host: url.hostname,
      port: url.port ? Number(url.port) : secure ? 465 : 587,
      // smtps: TLS implícito; smtp: STARTTLS quando o servidor oferecer.
      secure,
      ...(url.username
        ? {
            auth: {
              user: decodeURIComponent(url.username),
              pass: decodeURIComponent(url.password),
            },
          }
        : {}),
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 10_000,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.options.from,
      to: message.to.value,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  close(): void {
    this.transporter.close();
  }
}
