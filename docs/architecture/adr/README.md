# Architecture Decision Records

Processo: [0001](0001-record-architecture-decisions.md). Template: [0000](0000-template.md). Para criar: skill `/create-adr`.

| Nº                                                          | Decisão                                                          | Status                                |
| ----------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| [0001](0001-record-architecture-decisions.md)               | Registrar decisões com ADRs                                      | Aceito                                |
| [0002](0002-stack-and-versions.md)                          | Stack, versões e configuração do monorepo                        | Aceito                                |
| [0003](0003-modular-monolith-clean-architecture.md)         | Modular monolith com bibliotecas por contexto e camada           | Aceito (exceção substituída por 0016) |
| [0004](0004-multi-tenancy-shared-database.md)               | Multi-tenancy com banco compartilhado (RLS adiado — 0014)        | Aceito / RLS adiado (0014)            |
| [0005](0005-authentication-tokens-and-cookies.md)           | Access JWT curto + refresh opaco rotativo em cookies             | Aceito                                |
| [0006](0006-optimistic-locking.md)                          | Optimistic locking por versão                                    | Aceito                                |
| [0007](0007-kanban-ordering.md)                             | Ordenação Kanban com chaves fracionárias                         | Aceito                                |
| [0008](0008-domain-events-and-outbox.md)                    | Domain events pós-commit; Outbox quando justificado              | Aceito (Outbox: ver 0011)             |
| [0009](0009-frontend-state-with-signals.md)                 | Estado do frontend com Signals, sem NgRx                         | Aceito                                |
| [0010](0010-tailwind-and-angular-material.md)               | Tailwind e Angular Material com tokens compartilhados            | Aceito                                |
| [0011](0011-early-worker-and-outbox-for-email.md)           | Worker BullMQ e Outbox antecipados para e-mails transacionais    | Aceito                                |
| [0012](0012-tenant-in-api-path.md)                          | Organização ativa no caminho da API                              | Aceito                                |
| [0013](0013-authorization-shared-kernel.md)                 | Vocabulário de autorização como Shared Kernel e papel efetivo    | Aceito                                |
| [0014](0014-rls-deferred.md)                                | Row Level Security adiado para a Fase 4                          | Aceito                                |
| [0015](0015-cross-context-referential-integrity.md)         | Integridade referencial entre bounded contexts no banco          | Aceito                                |
| [0016](0016-kanban-board-as-tasks-view.md)                  | Quadro Kanban como visão de Tasks; contexto Boards adiado        | Aceito                                |
| [0017](0017-outbox-for-cross-context-integration-events.md) | Outbox para eventos de integração entre contextos (notificações) | Proposto                              |
