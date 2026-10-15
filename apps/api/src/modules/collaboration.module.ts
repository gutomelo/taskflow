import type { Logger } from 'pino';
import {
  CreateCommentUseCase,
  DeleteCommentUseCase,
  EditCommentUseCase,
  GetCommentUseCase,
  ListActiveMentionsUseCase,
  ListCommentsUseCase,
  ListMentionCandidatesUseCase,
  type CollaborationDependencies,
  type CollaborationEventRecorder,
  type CollaborationUserDirectory,
  type TaskDiscussionAccess,
} from '@taskflow/backend/collaboration/application';
import {
  collaborationErrorMappings,
  createCollaborationRouter,
} from '@taskflow/backend/collaboration/http';
import { PrismaCommentRepository } from '@taskflow/backend/collaboration/infrastructure';
import type {
  OutboxWriter,
  RateLimiter,
  TransactionRunner,
} from '@taskflow/backend/shared/application';
import type { PrismaTransactionRunner } from '@taskflow/backend/shared/infrastructure';
import type { Clock, IdGenerator } from '@taskflow/backend/shared/kernel';

export interface CollaborationModuleDependencies {
  readonly logger: Logger;
  /** A mesma instância dos outros módulos (a porta roda na transação de `collaboration`). */
  readonly transactions: PrismaTransactionRunner & TransactionRunner;
  readonly rateLimiter: RateLimiter;
  /** Eventos de integração na transação do comentário (ADR 0017). */
  readonly outbox: OutboxWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** Adaptador para `tasks`, `projects` e `identity` (último passo da ordem de montagem). */
  readonly discussion: TaskDiscussionAccess;
  /** Nomes de membros atuais (`organizations` + `identity`). */
  readonly users: CollaborationUserDirectory;
}

/** Composition root do contexto Collaboration (spec 010). Montado depois de `tasks`. */
export function createCollaborationModule(deps: CollaborationModuleDependencies) {
  // Eventos `collaboration.*` no log estruturado, só com ids, depois do commit (RNF-06).
  const events: CollaborationEventRecorder = {
    record: (event) => deps.logger.info({ collaborationEvent: event }, event.type),
  };
  const shared: CollaborationDependencies = {
    discussion: deps.discussion,
    comments: new PrismaCommentRepository(deps.transactions),
    users: deps.users,
    transactions: deps.transactions,
    rateLimiter: deps.rateLimiter,
    events,
    outbox: deps.outbox,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  };
  const useCases = {
    listComments: new ListCommentsUseCase(shared),
    getComment: new GetCommentUseCase(shared),
    listMentionCandidates: new ListMentionCandidatesUseCase(shared),
    createComment: new CreateCommentUseCase(shared),
    editComment: new EditCommentUseCase(shared),
    deleteComment: new DeleteCommentUseCase(shared),
  };
  return {
    useCases,
    /** Spec 008: menções ativas em lote (porta `NotificationTargets`). */
    notifications: { activeMentions: new ListActiveMentionsUseCase(shared) },
    /** Rotas tenant-scoped, montadas pelo composition root no `createTenantScope`. */
    tenantRouter: createCollaborationRouter({ useCases }),
    domainErrors: collaborationErrorMappings,
  };
}

export type CollaborationModule = ReturnType<typeof createCollaborationModule>;
