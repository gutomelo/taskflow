import type { OrganizationRole } from '@taskflow/contracts';

// Textos de interface de organizações (pt-BR), centralizados para a futura internacionalização.
export const ROLE_LABELS: Readonly<Record<OrganizationRole, string>> = {
  owner: 'Proprietário(a)',
  admin: 'Administrador(a)',
  member: 'Membro',
  viewer: 'Leitor(a)',
};

export const organizationMessages = {
  greeting: (name: string) => `Olá, ${name}!`,
  youAreIn: (organization: string, role: string) => `Você está em “${organization}” como ${role}.`,
  sectionNav: 'Seções da organização',
  home: 'Início',
  members: 'Membros',
  settings: 'Configurações',
  securityTitle: 'Segurança da conta',
  securityBody: 'Veja onde sua conta está conectada e troque sua senha.',
  statusTitle: 'Status do sistema',
  statusBody: 'Verifique se a API e os serviços estão operacionais.',
} as const;

export const createOrganizationMessages = {
  title: 'Crie sua organização',
  intro: 'A organização reúne as pessoas e os projetos do seu time. Você será o proprietário.',
  name: 'Nome da organização',
  slug: 'Endereço',
  slugHint: (slug: string) => `Seu endereço: /o/${slug || '…'} — não pode ser alterado depois.`,
  submit: 'Criar organização',
  submitting: 'Criando…',
  unverified:
    'Confirme seu e-mail para criar uma organização. Use o aviso no topo da página para reenviar o link.',
  validation: {
    nameRequired: 'Informe o nome da organização.',
    nameLength: 'Use de 2 a 80 caracteres.',
    slugRequired: 'Informe o endereço.',
    slugFormat:
      'Use de 3 a 40 letras minúsculas, números e hífens, começando por letra e sem hífen no fim.',
  },
  errors: {
    INVALID_SLUG: 'Este endereço não pode ser usado. Alguns nomes são reservados; escolha outro.',
    SLUG_TAKEN: 'Este endereço já está em uso. Escolha outro.',
    INVALID_ORGANIZATION_NAME: 'Nome inválido: use texto comum, de 2 a 80 caracteres.',
    EMAIL_NOT_VERIFIED: 'Confirme seu e-mail para criar uma organização.',
    ORGANIZATION_LIMIT_REACHED: 'Você atingiu o limite de organizações.',
  },
} as const;

export const organizationListMessages = {
  title: 'Suas organizações',
  intro: 'Escolha onde trabalhar agora.',
  listLabel: 'Organizações das quais você participa',
  create: 'Criar organização',
  empty: 'Você ainda não participa de nenhuma organização.',
  invitationHint: 'Recebeu um convite? Abra o link do e-mail para entrar na organização.',
  notFound: 'Organização não encontrada ou você não tem mais acesso a ela.',
  loading: 'Carregando organizações…',
  loadFailed: 'Não foi possível carregar suas organizações.',
  retry: 'Tentar de novo',
} as const;

const DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' });
export const formatDate = (isoDate: string) => DATE.format(new Date(isoDate));

export const membersMessages = {
  title: 'Membros',
  listLabel: 'Membros da organização',
  you: 'você',
  joinedAt: (date: string) => `Desde ${date}`,
  noName: 'Conta indisponível',
  roleLabel: (name: string) => `Papel de ${name}`,
  saveRole: 'Salvar papel',
  remove: 'Remover',
  removeLabel: (name: string) => `Remover ${name}`,
  confirmRemove: (name: string) => `Remover ${name} da organização?`,
  leave: 'Sair da organização',
  confirmLeave: 'Sair desta organização? Você perde o acesso imediatamente.',
  confirm: 'Confirmar',
  cancel: 'Cancelar',
  loadMore: 'Carregar mais',
  loading: 'Carregando membros…',
  loadFailed: 'Não foi possível carregar os membros.',
  retry: 'Tentar de novo',
  roleChanged: (name: string, role: string) => `${name} agora é ${role}.`,
  removed: (name: string) => `${name} foi removido(a) da organização.`,
  errors: {
    LAST_OWNER: 'A organização precisa de pelo menos um proprietário. Promova outra pessoa antes.',
    ROLE_CHANGE_NOT_ALLOWED: 'Seu papel não permite esta alteração.',
    INSUFFICIENT_ROLE: 'Seu papel não permite esta ação.',
    VERSION_CONFLICT:
      'Os dados mudaram enquanto você editava. A lista foi atualizada; tente de novo.',
    MEMBER_NOT_FOUND: 'Esta pessoa não é mais membro. A lista foi atualizada.',
  },
} as const;

export const invitationsMessages = {
  title: 'Convites',
  intro:
    'Convide pessoas pelo e-mail. O convite vale por 7 dias e só a conta com esse e-mail pode aceitá-lo.',
  email: 'E-mail',
  role: 'Papel',
  invite: 'Convidar',
  inviting: 'Enviando…',
  listLabel: 'Convites pendentes',
  empty: 'Nenhum convite pendente.',
  invitedBy: (name: string | null) =>
    name ? `Convidado(a) por ${name}` : 'Convidante indisponível',
  expiresAt: (date: string) => `Vale até ${date}`,
  expired: 'Expirado',
  resend: 'Reenviar',
  resendLabel: (email: string) => `Reenviar convite para ${email}`,
  revoke: 'Revogar',
  revokeLabel: (email: string) => `Revogar convite para ${email}`,
  confirmRevoke: (email: string) => `Revogar o convite para ${email}?`,
  confirm: 'Confirmar',
  cancel: 'Cancelar',
  loadFailed: 'Não foi possível carregar os convites.',
  loadMore: 'Carregar mais',
  retry: 'Tentar de novo',
  invited: (email: string) => `Convite enviado para ${email}.`,
  reinvited: (email: string) => `Convite para ${email} atualizado e reenviado.`,
  resent: (email: string) => `Convite reenviado para ${email}. O link anterior deixou de valer.`,
  revoked: (email: string) => `Convite para ${email} revogado.`,
  validation: {
    emailRequired: 'Informe o e-mail.',
    emailInvalid: 'Informe um e-mail válido.',
  },
  errors: {
    ALREADY_A_MEMBER: 'Esta pessoa já é membro da organização.',
    INVALID_EMAIL_ADDRESS: 'Informe um e-mail válido.',
    INVITATION_NOT_FOUND: 'Este convite não está mais pendente. A lista foi atualizada.',
    INSUFFICIENT_ROLE: 'Seu papel não permite gerenciar convites.',
  },
} as const;

export const settingsMessages = {
  title: 'Configurações',
  name: 'Nome da organização',
  slug: 'Endereço',
  slugFixed: (slug: string) => `/o/${slug} — o endereço não pode ser alterado.`,
  save: 'Salvar',
  saving: 'Salvando…',
  saved: 'Nome atualizado.',
  readOnly: 'Só proprietários e administradores alteram o nome.',
  loadFailed: 'Não foi possível carregar a organização.',
  retry: 'Tentar de novo',
  errors: {
    VERSION_CONFLICT:
      'A organização foi alterada por outra pessoa. Os dados foram atualizados; revise e salve de novo.',
    INVALID_ORGANIZATION_NAME: 'Nome inválido: use texto comum, de 2 a 80 caracteres.',
    INSUFFICIENT_ROLE: 'Seu papel não permite alterar o nome.',
  },
} as const;

/** Mensagem específica de um `code` da API, se houver (sem cast: o mapa é lido como entradas). */
export function codeMessage(
  map: Readonly<Record<string, string>>,
  code: string | null,
): string | null {
  return Object.entries(map).find(([key]) => key === code)?.[1] ?? null;
}

export const acceptInvitationMessages = {
  title: 'Convite para uma organização',
  loading: 'Verificando o convite…',
  noToken:
    'Abra o link do convite que chegou por e-mail. Se esta aba foi recarregada no caminho, abra o link de novo: ele vale por 7 dias.',
  needsLogin: 'Entre ou crie sua conta com o e-mail convidado para ver e aceitar o convite.',
  signIn: 'Entrar',
  register: 'Criar conta',
  checkAgain: 'Já entrei em outra aba',
  invitation: (inviter: string | null, organization: string, role: string) =>
    `${inviter ? `“${inviter}” convidou você` : 'Você foi convidado(a)'} para a organização “${organization}”, com o papel de ${role}.`,
  validUntil: (date: string) => `O convite vale até ${date}.`,
  accept: 'Aceitar convite',
  accepting: 'Aceitando…',
  wrongAccount: (masked: string) =>
    `Este convite é para ${masked}. Entre com essa conta para aceitá-lo; nada foi alterado nesta conta.`,
  needsVerification:
    'Confirme seu e-mail para aceitar o convite. Depois de confirmar (pelo link que enviamos), volte aqui.',
  verifiedNow: 'Já confirmei meu e-mail',
  alreadyMember: 'Você já participa desta organização.',
  goToOrganizations: 'Ver minhas organizações',
  invalid:
    'Este convite é inválido, expirou ou já foi usado. Peça um novo convite a quem convidou você.',
  limitReached: 'Você atingiu o limite de organizações e não pode aceitar este convite agora.',
  retry: 'Tentar de novo',
} as const;
