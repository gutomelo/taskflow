import type { IdentityEmailTemplates } from '@taskflow/backend/identity/application';
import { renderEmail } from './email-layout';

/** Textos pt-BR dos e-mails de identidade (spec 001). Assuntos sem dados do usuário. */
export const ptBrIdentityEmailTemplates: IdentityEmailTemplates = {
  emailVerification: ({ recipient, link, validForHours }) =>
    renderEmail(recipient, 'Confirme seu e-mail no TaskFlow', [
      {
        kind: 'paragraph',
        text: 'Confirme seu endereço de e-mail para começar a usar o TaskFlow.',
      },
      { kind: 'action', label: 'Confirmar e-mail', href: link },
      {
        kind: 'paragraph',
        text: `O link vale por ${validForHours} horas e só pode ser usado uma vez. Se você não criou uma conta no TaskFlow, ignore este e-mail.`,
      },
    ]),

  passwordReset: ({ recipient, link, validForMinutes }) =>
    renderEmail(recipient, 'Redefina sua senha do TaskFlow', [
      {
        kind: 'paragraph',
        text: 'Recebemos um pedido para redefinir a senha da sua conta no TaskFlow.',
      },
      { kind: 'action', label: 'Redefinir senha', href: link },
      {
        kind: 'paragraph',
        text: `O link vale por ${validForMinutes} minutos e só pode ser usado uma vez. Se você não fez o pedido, ignore este e-mail: sua senha continua a mesma.`,
      },
    ]),

  accountAlreadyExists: ({ recipient, loginLink, forgotPasswordLink }) =>
    renderEmail(recipient, 'Tentativa de cadastro com o seu e-mail', [
      {
        kind: 'paragraph',
        text: 'Alguém tentou criar uma conta no TaskFlow com este endereço, mas ele já está cadastrado. Nenhuma conta foi criada e a sua não foi alterada.',
      },
      { kind: 'paragraph', text: 'Se foi você, basta entrar com a sua senha.' },
      { kind: 'action', label: 'Entrar no TaskFlow', href: loginLink },
      {
        kind: 'paragraph',
        text: `Esqueceu a senha? Peça uma nova em ${forgotPasswordLink}. Se não foi você, nenhuma ação é necessária.`,
      },
    ]),

  passwordChanged: ({ recipient, forgotPasswordLink }) =>
    renderEmail(recipient, 'Sua senha do TaskFlow foi alterada', [
      {
        kind: 'paragraph',
        text: 'A senha da sua conta no TaskFlow foi alterada, e as sessões abertas em outros dispositivos foram encerradas.',
      },
      {
        kind: 'paragraph',
        text: 'Se não foi você, redefina a senha agora para recuperar o acesso.',
      },
      { kind: 'action', label: 'Redefinir senha', href: forgotPasswordLink },
    ]),
};
