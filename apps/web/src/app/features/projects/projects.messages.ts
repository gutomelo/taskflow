import type { ProjectRole } from '@taskflow/contracts';

// Textos de interface de projetos (pt-BR), centralizados para a futura internacionalização.
export const PROJECT_ROLE_LABELS: Readonly<Record<ProjectRole, string>> = {
  manager: 'Gerente',
  member: 'Membro',
  viewer: 'Leitor(a)',
};

export const projectListMessages = {
  title: 'Projetos',
  intro: 'Projetos da organização dos quais você participa.',
  introAll: 'Todos os projetos da organização (proprietários e administradores veem todos).',
  filterLabel: 'Filtrar projetos',
  active: 'Ativos',
  archived: 'Arquivados',
  create: 'Novo projeto',
  listLabel: 'Projetos',
  empty: 'Nenhum projeto ativo por aqui ainda.',
  emptyArchived: 'Nenhum projeto arquivado.',
  loading: 'Carregando projetos…',
  loadFailed: 'Não foi possível carregar os projetos.',
  retry: 'Tentar de novo',
  loadMore: 'Carregar mais',
  yourRole: (role: string) => `Seu papel: ${role}`,
  archivedBadge: 'Arquivado',
  notFound: 'Projeto não encontrado ou você não tem mais acesso a ele.',
} as const;

export const createProjectMessages = {
  title: 'Novo projeto',
  intro: 'O projeto reúne tarefas, quadro e pessoas. A chave identifica as tarefas (ex.: WEB-42).',
  name: 'Nome do projeto',
  key: 'Chave',
  keyHint: (key: string) => `Tarefas como ${key || '…'}-1 — não pode ser alterada depois.`,
  description: 'Descrição (opcional)',
  submit: 'Criar projeto',
  submitting: 'Criando…',
  cancel: 'Cancelar',
  validation: {
    nameRequired: 'Informe o nome do projeto.',
    nameLength: 'Use de 2 a 80 caracteres.',
    keyRequired: 'Informe a chave.',
    keyFormat: 'Use de 2 a 10 letras maiúsculas ou dígitos, começando por letra.',
    descriptionLength: 'Use no máximo 2000 caracteres.',
  },
  errors: {
    INVALID_PROJECT_KEY:
      'Chave inválida: use de 2 a 10 letras maiúsculas ou dígitos, começando por letra.',
    PROJECT_KEY_TAKEN: 'Esta chave já é usada por um projeto da organização. Escolha outra.',
    INVALID_PROJECT_NAME: 'Nome inválido: use texto comum, de 2 a 80 caracteres.',
    INVALID_PROJECT_DESCRIPTION: 'Descrição inválida: remova caracteres especiais invisíveis.',
    INSUFFICIENT_ROLE: 'Seu papel não permite criar projetos nesta organização.',
    PROJECT_LIMIT_REACHED: 'A organização atingiu o limite de projetos.',
  },
} as const;

export const projectAreaMessages = {
  sectionNav: 'Seções do projeto',
  overview: 'Visão geral',
  board: 'Quadro',
  tasks: 'Tarefas',
  members: 'Participantes',
  settings: 'Configurações',
  loading: 'Carregando projeto…',
  loadFailed: 'Não foi possível carregar o projeto.',
  retry: 'Tentar de novo',
  archivedBadge: 'Arquivado',
  archivedNotice: 'Este projeto está arquivado: só leitura até ser restaurado.',
  backToProjects: 'Projetos',
} as const;

export const projectOverviewMessages = {
  description: 'Descrição',
  noDescription: 'Sem descrição.',
  key: 'Chave',
  yourRole: 'Seu papel',
  workflow: 'Fluxo de trabalho',
  workflowHint: 'Status das tarefas e as mudanças permitidas entre eles.',
  workflowLoading: 'Carregando fluxo…',
  workflowFailed: 'Não foi possível carregar o fluxo de trabalho.',
  transition: (from: string, to: string) => `${from} → ${to}`,
  categories: { todo: 'A fazer', in_progress: 'Em andamento', done: 'Concluído' },
} as const;

export const projectSettingsMessages = {
  title: 'Configurações do projeto',
  name: 'Nome do projeto',
  description: 'Descrição',
  save: 'Salvar',
  saving: 'Salvando…',
  saved: 'Alterações salvas.',
  readOnly: 'Só gerentes do projeto alteram as configurações.',
  archiveTitle: 'Arquivar projeto',
  archiveBody:
    'O projeto sai da lista padrão e fica somente leitura. Você pode restaurá-lo depois.',
  archive: 'Arquivar',
  confirmArchive: 'Arquivar este projeto?',
  restoreTitle: 'Restaurar projeto',
  restoreBody: 'O projeto volta à lista e aceita alterações novamente.',
  restore: 'Restaurar',
  confirm: 'Confirmar',
  cancel: 'Cancelar',
  archived: 'Projeto arquivado.',
  restored: 'Projeto restaurado.',
  validation: {
    nameRequired: 'Informe o nome do projeto.',
    nameLength: 'Use de 2 a 80 caracteres.',
    descriptionLength: 'Use no máximo 2000 caracteres.',
  },
  errors: {
    VERSION_CONFLICT:
      'O projeto foi alterado por outra pessoa. Os dados foram atualizados; revise e tente de novo.',
    PROJECT_ARCHIVED: 'O projeto está arquivado. Restaure-o para alterar.',
    INSUFFICIENT_ROLE: 'Seu papel não permite esta ação.',
    INVALID_PROJECT_NAME: 'Nome inválido: use texto comum, de 2 a 80 caracteres.',
    INVALID_PROJECT_DESCRIPTION: 'Descrição inválida: remova caracteres especiais invisíveis.',
  },
} as const;

export const projectMembersMessages = {
  title: 'Participantes',
  managersNote:
    'Proprietários e administradores da organização gerenciam todos os projetos, mesmo sem aparecer aqui.',
  listLabel: 'Participantes do projeto',
  loading: 'Carregando participantes…',
  loadFailed: 'Não foi possível carregar os participantes.',
  retry: 'Tentar de novo',
  loadMore: 'Carregar mais',
  noName: 'Conta indisponível',
  effective: (role: string) => `Atua como ${role} (limite do papel na organização)`,
  roleLabel: (name: string) => `Papel de ${name} no projeto`,
  saveRole: 'Salvar papel',
  remove: 'Remover',
  removeLabel: (name: string) => `Remover ${name} do projeto`,
  confirmRemove: (name: string) => `Remover ${name} do projeto?`,
  leave: 'Sair do projeto',
  confirmLeave: 'Sair deste projeto? Você perde o acesso a ele.',
  confirm: 'Confirmar',
  cancel: 'Cancelar',
  roleChanged: (name: string, role: string) => `${name} agora é ${role} no projeto.`,
  removed: (name: string) => `${name} foi removido(a) do projeto.`,
  addTitle: 'Adicionar participante',
  addHint: 'Só membros da organização. Leitores da organização entram apenas como leitores.',
  person: 'Pessoa',
  role: 'Papel no projeto',
  add: 'Adicionar',
  added: (name: string) => `${name} agora participa do projeto.`,
  noCandidates: 'Todos os membros da organização que podem participar já estão no projeto.',
  moreCandidates: 'Ver mais pessoas',
  errors: {
    VERSION_CONFLICT:
      'Os dados mudaram enquanto você editava. A lista foi atualizada; tente de novo.',
    PROJECT_MEMBER_NOT_FOUND: 'Esta pessoa não participa mais do projeto. A lista foi atualizada.',
    MEMBER_NOT_FOUND: 'Esta pessoa não é mais membro da organização.',
    ALREADY_A_PROJECT_MEMBER: 'Esta pessoa já participa do projeto.',
    ALREADY_MANAGES_ALL_PROJECTS: 'Proprietários e administradores já gerenciam todos os projetos.',
    PROJECT_ROLE_ABOVE_CEILING:
      'O papel da pessoa na organização não permite este papel no projeto.',
    PROJECT_ARCHIVED:
      'O projeto está arquivado: não aceita novos participantes nem mudanças de papel.',
    PROJECT_MEMBER_LIMIT_REACHED: 'O projeto atingiu o limite de participantes.',
    INSUFFICIENT_ROLE: 'Seu papel não permite esta ação.',
  },
} as const;

export const workflowSettingsMessages = {
  title: 'Fluxo de trabalho',
  intro:
    'Os status são as colunas do quadro; as transições dizem para onde cada coluna pode mandar os cards.',
  loading: 'Carregando fluxo…',
  loadFailed: 'Não foi possível carregar o fluxo de trabalho.',
  retry: 'Tentar de novo',
  statusesLabel: 'Status do fluxo',
  name: (name: string) => `Nome de ${name}`,
  category: (name: string) => `Categoria de ${name}`,
  categoryLocked: 'Tem tarefas: a categoria não muda.',
  rename: 'Salvar nome',
  up: (name: string) => `Subir ${name}`,
  down: (name: string) => `Descer ${name}`,
  remove: (name: string) => `Remover ${name}`,
  target: 'Mover as tarefas para',
  confirmRemove: 'Confirmar remoção',
  cancel: 'Cancelar',
  noTarget: 'Não há outro status desta categoria para receber as tarefas.',
  newStatus: 'Novo status',
  newName: 'Nome do status',
  newCategory: 'Categoria',
  create: 'Criar status',
  transitionsTitle: 'Transições permitidas',
  transitionsHint: 'Marque para onde cada status pode mandar os cards.',
  transition: (from: string, to: string) => `De ${from} para ${to}`,
  saveTransitions: 'Salvar transições',
  saved: 'Fluxo atualizado.',
  errors: {
    VERSION_CONFLICT:
      'O fluxo foi alterado por outra pessoa. Os dados foram atualizados; revise e tente de novo.',
    STATUS_NAME_TAKEN: 'Já existe um status com este nome.',
    INVALID_STATUS_NAME: 'Nome inválido: use de 1 a 40 caracteres.',
    STATUS_IN_USE: 'O status tem tarefas: a categoria não muda.',
    INVALID_STATUS_TARGET: 'Escolha outro status da mesma categoria para receber as tarefas.',
    WORKFLOW_NEEDS_TODO_STATUS: 'O fluxo precisa de ao menos um status "a fazer".',
    STATUS_LIMIT_REACHED: 'O projeto atingiu o limite de status.',
    STATUS_NOT_FOUND: 'O status não existe mais. Os dados foram atualizados.',
    PROJECT_ARCHIVED: 'O projeto está arquivado: o fluxo é somente leitura.',
    INSUFFICIENT_ROLE: 'Seu papel não permite configurar o fluxo.',
  },
} as const;
