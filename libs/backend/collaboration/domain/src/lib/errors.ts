import { DomainError } from '@taskflow/backend/shared/kernel';

/**
 * Comentário inexistente, de outra organização ou de projeto sem leitura: o mesmo 404 em todas as
 * rotas endereçadas por comentário (M1 da revisão de segurança).
 */
export class CommentNotFoundError extends DomainError {
  readonly code = 'COMMENT_NOT_FOUND';
  constructor() {
    super('Comment not found');
  }
}

/** BR-031: texto vazio, malformado, com controle, formatação bidi ou acima do limite. */
export class InvalidCommentBodyError extends DomainError {
  readonly code = 'INVALID_COMMENT_BODY';
  constructor() {
    super('Invalid comment body');
  }
}

/** BR-032: mais pessoas distintas mencionadas do que o teto por comentário. */
export class TooManyMentionsError extends DomainError {
  readonly code = 'TOO_MANY_MENTIONS';
  constructor() {
    super('Too many mentions in the comment');
  }
}

/**
 * BR-032: menção a quem não lê o projeto. O mesmo corpo para inexistente, de outra organização e
 * sem acesso: não revela quem existe.
 */
export class InvalidMentionError extends DomainError {
  readonly code = 'INVALID_MENTION';
  constructor() {
    super('A mentioned person cannot read this project');
  }
}

/** BR-031: comentário removido não pode ser editado. */
export class CommentDeletedError extends DomainError {
  readonly code = 'COMMENT_DELETED';
  constructor() {
    super('The comment was removed');
  }
}

/** Teto (suave) de comentários não removidos por tarefa. */
export class CommentLimitReachedError extends DomainError {
  readonly code = 'COMMENT_LIMIT_REACHED';
  constructor() {
    super('The task reached the comment limit');
  }
}
