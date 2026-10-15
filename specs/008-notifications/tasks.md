# 008 — Notificações · Tarefas

Regras: uma tarefa por vez; marcar `[x]` somente com evidência executada (seção abaixo). Toda tarefa termina com `pnpm nx affected -t lint typecheck test` passando; tarefas com persistência, portas, worker ou isolamento também com `integration-test` nos projetos afetados. Mutation testing manual nas regras novas.

## Bloco A — Domínio e persistência

| ID  | Tarefa                                                                                                                                                                                                                                                                                           | Depende de | Verificação                                        | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------- | ------ |
| T1  | `notifications/domain`: `NotificationKind`, chaves de deduplicação, limites, contratos de repositório (sempre `organizationId` + `recipientUserId`)                                                                                                                                              | —          | testes de domínio (BR-033)                         | [ ]    |
| T2  | Prisma `notifications.prisma` + migration (FKs para memberships e tasks com cascata, único de deduplicação, `occurred_at`, índices parciais manuais com `INCLUDE`, índice da cascata); back-relations inertes; linhas no ADR 0015; lints `notificationsMustNotReachOtherContexts` e ampliações   | T1         | integração: catálogo, cascatas                     | [ ]    |
| T3  | Repositórios: insert por destinatário `ON CONFLICT DO NOTHING` com `P2003` ⇒ descarte, lista por keyset `(occurred_at, id)`, não lidas recentes (200), marcar lida(s) com `upToId`, teto de menções, candidatos ao resumo (24 h, ≤ 50), `emailed_at` condicional, retenção em lotes; preferência | T2         | integração (filtro por organização e destinatário) | [ ]    |

## Bloco B — Produtores e aplicação

| ID  | Tarefa                                                                                                                                                                                                                                                       | Depende de | Verificação                                                   | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------- | ------ |
| T4  | Produtores (ADR 0017): cascas de `collaboration` e `tasks` gravam `collaboration.mentions_added` e `tasks.assignee_changed` pela `OutboxWriter` dentro da transação (função pura de tradução); payloads tipados na `application` de cada um; ADR 0017 Aceito | —          | testes com fakes (evento gravado e revertido com a transação) | [ ]    |
| T5  | Fornecedores das portas, em lote: `projects.ResolveReadableProjects` (+ método na `ProjectAccess`), `tasks.ResolveVisibleTasks`, `collaboration.ListActiveMentions` (amarrada à tarefa)                                                                      | —          | testes de caso de uso; integração                             | [ ]    |
| T6  | `notifications/application`: `RecordNotifications`, `ListNotifications`, `CountUnread`, `MarkRead`, `MarkAllRead`, preferências, `PlanDigests`, `SendDigest`, `PurgeOldNotifications`; portas falhando fechado; limites; fakes                               | T1, T5     | testes com fakes (CA-01..CA-07)                               | [ ]    |

## Bloco C — API, worker, isolamento

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                         | Depende de | Verificação                                                                                       | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------- | ------ |
| T7  | `apps/api`: módulo e adaptadores; `OutboxWriter` em `tasks` e `collaboration`; contratos, router, erros, OpenAPI; rotas `/me` na allowlist                                                                                                                                                                                     | T3, T4, T6 | testes do router; `openapi.spec`; composição                                                      | [ ]    |
| T8  | `apps/worker`: relay único com rotas `emails` + `notifications`; `notification-jobs.ts` (Zod `satisfies` o payload do produtor, anticorrupção); `notifications.module.ts` (adaptadores só de leitura); fan-out horário e job por pessoa (`jobId` por hora); template sem nomes (teste com valores hostis); retenção de 90 dias | T6         | integração com PostgreSQL e Redis (worker parado/voltando, idempotência, e-mail no SMTP de teste) | [ ]    |
| T9  | Harness (cursor `noLeak`) e **duas** baterias: entre organizações e entre usuários da mesma organização (owner, admin, member, viewer)                                                                                                                                                                                         | T7         | `route-coverage.spec`; integração (CA-08)                                                         | [ ]    |

## Bloco D — Frontend e jornada

| ID  | Tarefa                                                                                              | Depende de | Verificação                             | Status |
| --- | --------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------- | ------ |
| T10 | Sino com contador (polling 60 s e `visibilitychange`), página de notificações, preferência na conta | T7         | testes de componente (CA-09)            | [ ]    |
| T11 | E2E: menção e atribuição viram notificações; resumo chega no Mailpit sem conteúdo                   | T8, T10    | Playwright no banco descartável (CA-10) | [ ]    |

## Bloco E — Documentação e validação

| ID  | Tarefa                                                                                                                                                                                                                          | Depende de | Verificação                                                           | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- | ------ |
| T12 | Docs: `bounded-contexts.md`, `dependency-rules.md`, `business-rules.md` (BR-033, BR-034), `data-flow.md` §4, `authorization.md`, `multi-tenancy.md`, `testing.md`; ADR 0008 (Outbox aceita para notificações); índice e roadmap | T1–T11     | verificação de links                                                  | [ ]    |
| T13 | `/review-code` e `/security-audit`; correções; gate final                                                                                                                                                                       | T12        | sem bloqueantes / sem Críticos-Altos; `pnpm verify`, integração e E2E | [ ]    |

## Evidências
