import type { DomainErrorMapping } from '@taskflow/backend/shared/http';

/**
 * Tradução dos códigos de `projects` para HTTP (design da spec 003). Títulos em pt-BR seguros para
 * exibição. `MEMBER_NOT_FOUND`, `ORGANIZATION_NOT_FOUND`, `INSUFFICIENT_ROLE` e `VERSION_CONFLICT`
 * reutilizam os códigos de `organizations` com o mesmo status e título (teste de colisão em
 * `apps/api`).
 */
export const projectsErrorMappings: Readonly<Record<string, DomainErrorMapping>> = {
  INVALID_PROJECT_KEY: {
    status: 400,
    title: 'Chave inválida: use de 2 a 10 letras maiúsculas ou dígitos, começando por letra',
  },
  INVALID_PROJECT_NAME: { status: 400, title: 'Nome do projeto inválido' },
  INVALID_PROJECT_DESCRIPTION: { status: 400, title: 'Descrição do projeto inválida' },
  PROJECT_KEY_TAKEN: { status: 409, title: 'Esta chave já é usada por um projeto da organização' },
  PROJECT_NOT_FOUND: { status: 404, title: 'Projeto não encontrado' },
  PROJECT_ARCHIVED: { status: 409, title: 'O projeto está arquivado' },
  PROJECT_LIMIT_REACHED: { status: 422, title: 'Limite de projetos da organização atingido' },
  PROJECT_MEMBER_NOT_FOUND: { status: 404, title: 'Participante não encontrado' },
  PROJECT_MEMBER_LIMIT_REACHED: {
    status: 422,
    title: 'Limite de participantes do projeto atingido',
  },
  ALREADY_A_PROJECT_MEMBER: { status: 409, title: 'Esta pessoa já participa do projeto' },
  ALREADY_MANAGES_ALL_PROJECTS: {
    status: 422,
    title: 'Proprietários e administradores já gerenciam todos os projetos',
  },
  PROJECT_ROLE_ABOVE_CEILING: {
    status: 422,
    title: 'O papel da pessoa na organização não permite este papel no projeto',
  },
  INVALID_STATUS_NAME: { status: 400, title: 'Nome de status inválido: use de 1 a 40 caracteres' },
  STATUS_NAME_TAKEN: { status: 409, title: 'Já existe um status com este nome no projeto' },
  STATUS_NOT_FOUND: { status: 404, title: 'Status não encontrado no workflow do projeto' },
  STATUS_IN_USE: { status: 409, title: 'O status tem tarefas' },
  INVALID_STATUS_TARGET: {
    status: 422,
    title: 'Escolha outro status da mesma categoria para receber as tarefas',
  },
  WORKFLOW_NEEDS_TODO_STATUS: {
    status: 422,
    title: 'O fluxo precisa de ao menos um status "a fazer"',
  },
  STATUS_LIMIT_REACHED: { status: 422, title: 'Limite de status do projeto atingido' },
  INVALID_STATUS_ORDER: { status: 422, title: 'A ordem precisa listar cada status uma vez' },
  INVALID_TRANSITION: { status: 422, title: 'Transição inválida' },
  MEMBER_NOT_FOUND: { status: 404, title: 'Membro não encontrado' },
  ORGANIZATION_NOT_FOUND: { status: 404, title: 'Organização não encontrada' },
  INSUFFICIENT_ROLE: { status: 403, title: 'Seu papel não permite esta ação' },
  VERSION_CONFLICT: {
    status: 409,
    title: 'Os dados foram alterados por outra operação. Tente novamente.',
  },
};
