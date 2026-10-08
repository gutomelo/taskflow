# Architecture Decision Records

Processo: [0001](0001-record-architecture-decisions.md). Template: [0000](0000-template.md). Para criar: skill `/create-adr`.

| Nº                                                  | Decisão                                                | Status                   |
| --------------------------------------------------- | ------------------------------------------------------ | ------------------------ |
| [0001](0001-record-architecture-decisions.md)       | Registrar decisões com ADRs                            | Aceito                   |
| [0002](0002-stack-and-versions.md)                  | Stack, versões e configuração do monorepo              | Aceito                   |
| [0003](0003-modular-monolith-clean-architecture.md) | Modular monolith com bibliotecas por contexto e camada | Aceito                   |
| [0004](0004-multi-tenancy-shared-database.md)       | Multi-tenancy com banco compartilhado (RLS proposto)   | Aceito / RLS Proposto    |
| [0005](0005-authentication-tokens-and-cookies.md)   | Access JWT curto + refresh opaco rotativo em cookies   | Proposto                 |
| [0006](0006-optimistic-locking.md)                  | Optimistic locking por versão                          | Aceito                   |
| [0007](0007-kanban-ordering.md)                     | Ordenação Kanban com chaves fracionárias               | Proposto                 |
| [0008](0008-domain-events-and-outbox.md)            | Domain events pós-commit; Outbox quando justificado    | Aceito / Outbox Proposto |
| [0009](0009-frontend-state-with-signals.md)         | Estado do frontend com Signals, sem NgRx               | Aceito                   |
| [0010](0010-tailwind-and-angular-material.md)       | Tailwind e Angular Material com tokens compartilhados  | Aceito                   |
