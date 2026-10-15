# 008 — Notificações · Tarefas

Regras: uma tarefa por vez; marcar `[x]` somente com evidência executada (seção abaixo). Toda tarefa termina com `pnpm nx affected -t lint typecheck test` passando; tarefas com persistência, portas, worker ou isolamento também com `integration-test` nos projetos afetados. Mutation testing manual nas regras novas.

## Bloco A — Domínio e persistência

| ID  | Tarefa                                                                                                                                                                                                                                                                                           | Depende de | Verificação                                        | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | -------------------------------------------------- | ------ |
| T1  | `notifications/domain`: `NotificationKind`, chaves de deduplicação, limites, contratos de repositório (sempre `organizationId` + `recipientUserId`)                                                                                                                                              | —          | testes de domínio (BR-033)                         | [x]    |
| T2  | Prisma `notifications.prisma` + migration (FKs para memberships e tasks com cascata, único de deduplicação, `occurred_at`, índices parciais manuais com `INCLUDE`, índice da cascata); back-relations inertes; linhas no ADR 0015; lints `notificationsMustNotReachOtherContexts` e ampliações   | T1         | integração: catálogo, cascatas                     | [x]    |
| T3  | Repositórios: insert por destinatário `ON CONFLICT DO NOTHING` com `P2003` ⇒ descarte, lista por keyset `(occurred_at, id)`, não lidas recentes (200), marcar lida(s) com `upToId`, teto de menções, candidatos ao resumo (24 h, ≤ 50), `emailed_at` condicional, retenção em lotes; preferência | T2         | integração (filtro por organização e destinatário) | [x]    |

## Bloco B — Produtores e aplicação

| ID  | Tarefa                                                                                                                                                                                                                                                       | Depende de | Verificação                                                   | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------- | ------ |
| T4  | Produtores (ADR 0017): cascas de `collaboration` e `tasks` gravam `collaboration.mentions_added` e `tasks.assignee_changed` pela `OutboxWriter` dentro da transação (função pura de tradução); payloads tipados na `application` de cada um; ADR 0017 Aceito | —          | testes com fakes (evento gravado e revertido com a transação) | [x]    |
| T5  | Fornecedores das portas, em lote: `projects.ResolveReadableProjects` (+ método na `ProjectAccess`), `tasks.ResolveVisibleTasks`, `collaboration.ListActiveMentions` (amarrada à tarefa)                                                                      | —          | testes de caso de uso; integração                             | [x]    |
| T6  | `notifications/application`: `RecordNotifications`, `ListNotifications`, `CountUnread`, `MarkRead`, `MarkAllRead`, preferências, `PlanDigests`, `SendDigest`, `PurgeOldNotifications`; portas falhando fechado; limites; fakes                               | T1, T5     | testes com fakes (CA-01..CA-07)                               | [x]    |

## Bloco C — API, worker, isolamento

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                         | Depende de | Verificação                                                                                       | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------- | ------ |
| T7  | `apps/api`: módulo e adaptadores; `OutboxWriter` em `tasks` e `collaboration`; contratos, router, erros, OpenAPI; rotas `/me` na allowlist                                                                                                                                                                                     | T3, T4, T6 | testes do router; `openapi.spec`; composição                                                      | [x]    |
| T8  | `apps/worker`: relay único com rotas `emails` + `notifications`; `notification-jobs.ts` (Zod `satisfies` o payload do produtor, anticorrupção); `notifications.module.ts` (adaptadores só de leitura); fan-out horário e job por pessoa (`jobId` por hora); template sem nomes (teste com valores hostis); retenção de 90 dias | T6         | integração com PostgreSQL e Redis (worker parado/voltando, idempotência, e-mail no SMTP de teste) | [x]    |
| T9  | Harness (cursor `noLeak`) e **duas** baterias: entre organizações e entre usuários da mesma organização (owner, admin, member, viewer)                                                                                                                                                                                         | T7         | `route-coverage.spec`; integração (CA-08)                                                         | [x]    |

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

### T1 — 2026-10-15

- **Entregue**:
  - Biblioteca `backend-notifications-domain` (tags `scope:backend`, `domain:notifications`, `type:domain`; alias).
  - `NotificationKind` e `NOTIFICATION_LIMITS` (teto de 20 menções, resumo de 50 itens em 24 h, retenção de 90 dias, contador analisando 200 com teto de 99).
  - Chaves de deduplicação (`mention:{commentId}`, `assignment:{eventId}`), `recipientsOf` (sem o ator, sem repetição), `dedupeKeyOf` e `requireOwn` (404 único).
  - Contratos `NotificationRepository` (sempre organização **e** destinatário) e `NotificationPreferenceRepository`; erro `NOTIFICATION_NOT_FOUND`.
- **Desvio**: como o design permitia (S5 da arquitetura), não há entidade com `markRead`. Marcar como lida é escrita direta no repositório.
- **Testes**: 3 (destinatários, deduplicação, 404).
- **Mutation testing**: 5 mutantes, 5 mortos.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=HEAD` exit 0.

### T2 — 2026-10-15

- **Entregue**:
  - `prisma/models/notifications.prisma` (`NotificationKind`, `Notification`, `NotificationPreference`).
  - Back-relations inertes: `Membership.notifications` e `Task.notifications`.
  - Migration `20261015120000_add_notifications`: SQL do `migrate diff` mais, à mão, os índices parciais `notifications_unread_idx` (com `INCLUDE`) e `notifications_digest_idx` e o CHECK "só menção tem comentário". Aplicada ao `taskflow_e2e`; `migrate diff` depois dela vazio (o Prisma não acusa drift dos índices parciais).
  - Lints: `notificationsMustNotReachOtherContexts` (nova); `tasksMustNotReachOtherContexts` e a regra de `organizations` passam a barrar `notification(s)`.
  - Biblioteca `backend-notifications-infrastructure`.
  - Duas linhas na tabela do ADR 0015.
- **Testes**: `notifications-schema.integration.spec.ts` (6): catálogo das FKs e dos índices parciais, CHECK, deduplicação por destinatário, FK de membro e de tarefa da mesma organização, cascatas (saída da organização, tarefa, organização). Também verdes as integrações de `organizations` (33) e `tasks` (25), por causa das back-relations.
- **Mutation testing**: 4 mutantes na migration (sem CHECK, índice sem `WHERE`, membership `RESTRICT`, deduplicação sem destinatário), 4 mortos.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=HEAD` exit 0.

### T3 — 2026-10-15

- **Entregue**: `PrismaNotificationRepository` e `PrismaNotificationPreferenceRepository`.
  - `insert` com `createMany … skipDuplicates`: devolve `created` ou `duplicate`; `P2003` vira `ineligible`.
  - Lista e não lidas por keyset `(occurred_at DESC, id DESC)`.
  - `findOwn`, `markRead` e `markAllRead` (com limite inclusivo), sempre com organização **e** destinatário.
  - Teto de menções por ator e destinatário, contado por `occurred_at`.
  - Fan-out do resumo em SQL próprio do contexto, com `LEFT JOIN` na preferência (sem linha = ligado).
  - Candidatas por pessoa (não lidas, não enviadas, na janela) e `markEmailed` condicional (`emailed_at IS NULL`, por destinatário).
  - Retenção em lotes.
  - Preferência: ligada por padrão, `upsert`.
- **Testes**: `notifications-persistence.integration.spec.ts` (7):
  - inserção (duplicada e inelegível: membro que saiu, tarefa excluída);
  - página com empate por id, só do destinatário e da organização;
  - marcar lida(s) sem tocar terceiros, com limite;
  - teto (outro ator e outro tipo não contam);
  - resumo (janela, preferência desligada, já lidas, várias organizações, enviada uma vez, só do destinatário);
  - retenção em lotes;
  - preferência.
- **Mutation testing**: 15 mutantes, 13 mortos de primeira. Os 2 sobreviventes (ator no teto, janela no fan-out) viraram casos de teste e morreram.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=HEAD` exit 0. `integration-test` de `notifications-infrastructure`: 13 testes passando.

### T4 — 2026-10-15

- **Entregue** (ADR 0017, Aceito na aprovação):
  - `tasks-integration-events.ts`: `TasksIntegrationEventType.assigneeChanged` (`tasks.assignee_changed`), `AssigneeChangedPayload` e a tradução pura de `tasks.assigned` com responsável não nulo. O produtor emite o fato, inclusive quando a pessoa atribui a si mesma (D7).
  - `collaboration-integration-events.ts`: `collaboration.mentions_added` com as menções novas. Na criação vão as menções; na edição, só as acrescentadas.
  - `runTaskMutation` e `runCommentMutation` gravam os eventos pela `OutboxWriter` **dentro** do `transactions.run`, depois do núcleo.
  - `TasksDependencies` e `CollaborationDependencies` ganharam `outbox`. Os módulos da API recebem o `shared.outbox` (`main.ts`) e os testes de composição usam `PrismaOutboxWriter`. Fakes com `InMemoryOutbox` registrado na transação.
  - Tipos e payloads exportados pela `application` de cada produtor.
- **Testes**: `tasks-integration-events.spec.ts` (3) e `collaboration-integration-events.spec.ts` (3):
  - evento com só ids e id único;
  - nada quando não há responsável ou menção nova, quando o responsável é removido e quando a escrita é recusada;
  - **BR-010**: com a Outbox falhando, a atribuição e o comentário são desfeitos.
- **Mutation testing**: 6 mutantes, 6 mortos (responsável nulo, tipo do evento, gravação fora da transação nos dois produtores, menções acrescentadas, lista vazia).
- **Gate**: `pnpm nx affected -t lint typecheck test --base=HEAD` exit 0. `api:integration-test`: 56 testes passando com a `OutboxWriter` real nas transações.

### T5 — 2026-10-15

- **Entregue** (fornecedores em lote da porta `NotificationTargets`):
  - **`projects`**: `ProjectRepository.findVisibleMany` (Prisma e fake) e `ResolveReadableProjectsUseCase`, que devolve `Map<projectId, { key }>` sem workflow, com no máximo 200 ids. Exposto em `createProjectsModule().contribution.readableProjects` e como método novo `readableProjects` da porta `ProjectAccess` de `tasks`, ligado no adaptador.
  - **`tasks`**: `TaskRepository.findAnyByIds` (Prisma e fake) e `ResolveVisibleTasksUseCase`: tarefas por ids, depois os projetos legíveis, devolvendo `{ key, title }`. Ausente = não visível.
  - **`collaboration`**: `CommentRepository.activeMentions` (menção existente em comentário não removido **da tarefa indicada**; chave `commentId|userId`) e `ListActiveMentionsUseCase`.
- **Testes**:
  - Unitários: projetos legíveis (owner, admin, member, viewer, outra organização, vazio, teto); tarefas visíveis por papel (viewer, owner, sem acesso, outra organização, inexistente); menções ativas (mantida, de outra tarefa, tirada na edição, comentário removido, outra organização).
  - Integração: `findVisibleMany` (participação e `seesAll`, só na organização), `findAnyByIds` (vários projetos, só na organização), `activeMentions` (tarefa, removido, organização).
- **Mutation testing**: 7 mutantes, 5 mortos de primeira. `p-admin` virou caso de teste e morreu. `c-deleted` é equivalente: a exclusão do comentário já apaga as linhas de menção, e o filtro `deletedAt` fica como defesa.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=HEAD` exit 0. Integração de `projects` (25), `tasks` (26) e `collaboration` (14) passando.

### T6 — 2026-10-15

- **Entregue**: biblioteca `backend-notifications-application` (aliases `…/application` e `…/application/testing`).
  - **Portas**: `NotificationTargets` (tarefas visíveis e menções ativas, em lote, falhando fechado), `NotificationPeople` (nomes de membros atuais, vínculos com slug e papel, endereço só verificado) e `DigestMailer`.
  - `visibleOnly`: filtro de validade em lote. Sem linhas, nenhuma chamada.
  - `RecordNotificationsUseCase`: um destinatário por vez, sem o ator, teto de menções por `occurred_at`, contagem de criadas, duplicadas, inelegíveis e cortadas.
  - Consultas: `ListNotificationsUseCase` (páginas curtas válidas, cursor validado), `CountUnreadUseCase` (200 analisadas, teto 99), `MarkReadUseCase` (404 único), `MarkAllReadUseCase` (`upToId`), preferências.
  - Resumo: `PlanDigestsUseCase` (fan-out, 24 h) e `SendDigestUseCase` (sem lock; agrupa pelo slug; só contagens, chaves e links; marca todas as candidatas depois do envio; preferência desligada não marca; sem endereço ou sem nada visível marca sem enviar).
  - `PurgeOldNotificationsUseCase` (lotes de 1 000) e limites por usuário (contador, lista, escrita).
- **Ajustes**:
  - A regra de lint `notificationsMustNotReachOtherContexts` vale só na infraestrutura (único lugar com Prisma): nas outras camadas `task` é campo das visões.
  - `capped` passou a significar "mais que 99". Com exatamente 99, o contador não mostra "99+". Design ajustado.
- **Testes**: `notifications.use-cases.spec.ts` (20):
  - registro: dedupe ao reprocessar e ao repor a menção, a si mesmo, inelegível sem afetar os outros, teto só de menções por ocorrência, 30 atribuições sem teto;
  - lista: só as próprias da organização, validade (menção removida, tarefa invisível sem vazar título, "Ex-membro"), páginas curtas e cursor, cursores inválidos;
  - contador: sem chamadas quando vazio, teto 99 e 100, porta falhando propaga, limite;
  - marcar lida(s): 404 para alheia (inclusive owner), inexistente e invisível; `upToId`, inclusive alheio;
  - preferências;
  - resumo: plano, conteúdo sem nomes nem títulos, uma vez, preferência, sem endereço, nada visível, organização deixada, falha de SMTP sem marcar;
  - retenção em mais de um lote.
- **Mutation testing**: 14 mutantes, 10 mortos de primeira. `cap` (defeito real, corrigido), `no-address-mark` e `purge-loop` viraram testes e morreram. `shortcut` era equivalente (`visibleOnly` já retorna antes) e saiu do código.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=HEAD` exit 0.

### T7 — 2026-10-15

- **Entregue**:
  - **Contratos** (`notifications.contract.ts`): tipo, parâmetro, consulta, notificação, página, contador, `read-all` com `upToId`, preferência.
  - **Biblioteca `backend-notifications-http`**: `createNotificationsRouters` com o router tenant-scoped (lista, contador, `read-all`, `:id/read`; parâmetro malformado dá 404) e o router global `/me/notification-preferences` (`authenticate`; `PUT` com CSRF). Também os mapeamentos de erro e o OpenAPI (tag Notifications).
  - **`organizations`**: `ListUserMembershipsUseCase` (vínculos com slug e papel), exposto em `access.userMemberships`.
  - **Exposição nos módulos**: `tasks.notifications.visibleTasks`, `collaboration.notifications.activeMentions` e `projects.contribution.readableProjects` (T5).
  - **Adaptadores** `notification-targets.adapter.ts` e `notification-people.adapter.ts` (nomes só de membros atuais em lotes de 100; vínculos filtrados; endereço só verificado).
  - **Ligação**: `notifications.module.ts`, montado por último em `main.ts`; `ApiModules.notifications` (router global e de tenant); `integration-api.ts`; `route-coverage.spec`; allowlist das duas rotas `/me`; documento OpenAPI.
  - **Antecipado da T9**: casos de isolamento das quatro rotas (cursor de B é `noLeak`; `notificationId` e `upToId` de B dão 404) e duas notificações de B semeadas no mundo do harness.
- **Testes**:
  - `catalog-parity.spec.ts` (2): tipos iguais em domínio e contratos; todo código mapeado.
  - `notifications-router.spec.ts` (3): fluxo contra os contratos; 404 para alheia, inexistente ou malformada; 400; preferência (padrão, CSRF, campo desconhecido, 401).
  - `openapi.spec.ts` (+1).
  - `organization.use-cases.spec.ts` (+1, vínculos).
  - `api:integration-test` 56 testes, inclusive as variantes novas do isolamento.
- **Mutation testing**: 4 mutantes no router (`upToId`, CSRF, 404 do malformado, `authenticate` na preferência), 4 mortos.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=HEAD` exit 0.

- **Entregue**:
  - `apps/worker/src/outbox-relay.ts`: relay **único**, montado no `main.ts` com as rotas de `emails` e `notifications`. Um tipo roteado por dois pipelines é erro de composição. O relay saiu de `email-delivery.ts`, que agora expõe `routes`. No shutdown, o relay para primeiro.
  - `queues/notification-jobs.ts`:
    - `discriminatedUnion` com `strictObject` (envelope e payload), uuids, `occurredAt` ISO, `userIds` de 1 a `MAX_MENTIONS_PER_COMMENT` sem repetição;
    - schemas com `satisfies z.ZodType<AssigneeChangedPayload | MentionsAddedPayload>`;
    - `toNotificationFact` como camada anticorrupção;
    - job inválido ⇒ `UnrecoverableError`.
  - `modules/notifications.module.ts`: adaptadores só de leitura (`projects` → `tasks`, `collaboration`, `organizations`, `identity`), mesmo comportamento dos da API.
  - `notification-delivery.ts`:
    - fila `notifications` → `RecordNotifications`;
    - fila `notification-digests` com job scheduler horário (`0 0 * * * *` UTC) que só faz o fan-out;
    - um job por pessoa com `jobId = digest-{userId}-{AAAAMMDDHH}`;
    - logs só com ids, tipo e contagens; falha de SMTP via `describeJobError`.
  - `PtBrDigestMailer` / `renderDigestEmail` em `notifications/infrastructure`: assunto fixo, saudação genérica, contagens por slug, chaves como links e opt-out. O layout compartilhado ganhou o bloco `links`.
  - Retenção de 90 dias na limpeza diária (`maintenance`); o relatório ganhou `notifications`.
- **Desvios**:
  - `jobId` com `-` em vez de `:`: o BullMQ 6 reserva `:` (aceita hoje só por compatibilidade). O design foi ajustado.
  - `ResolveVisibleTasksUseCase` e `SendDigestUseCase` passaram a exigir só as dependências que usam. Assim o worker não precisa de porta completa nem de rate limiter fictício.
- **Testes**:
  - unitários: 13 do consumidor e do `jobId`, 2 do relay, 3 do template (valores hostis, sem o nome do destinatário) e 1 do layout;
  - integração com PostgreSQL, Redis e Mailpit (`notification-delivery.integration.spec.ts`, 5 testes):
    - eventos gravados com o worker parado são registrados ao voltar, nunca para o ator;
    - republicação ⇒ `duplicate`, nada novo;
    - quem saiu da organização ⇒ descartado pela FK;
    - resumo: um e-mail por pessoa e hora, sem nome, título, texto nem nome da organização; quem não lê a tarefa não recebe, mas a candidata é marcada;
    - retenção de 90 dias;
  - o spec de e-mails foi adaptado ao relay único;
  - `worker:integration-test`: 14 de 14.
- **Mutation testing**: 17 mutantes, 17 mortos (13 unitários e 4 de integração: relay duplicado, `jobId` ausente, retenção desligada, usuário errado no job).
- **Gate**: `pnpm nx affected -t lint typecheck test --base=HEAD` exit 0 (33 projetos).

- **Entregue**:
  - Harness entre organizações: os 4 casos declarados (lista com cursor `noLeak` de B, contador, `read` e `read-all` com ids de B ⇒ 404) já tinham entrado com as rotas na T7. Aqui foram reexecutados junto com a integração completa.
  - Nova bateria entre usuários da mesma organização, `apps/api/src/modules/notifications-isolation.integration.spec.ts`. Usa a API real com a mesma composição do `main.ts` e PostgreSQL. Para owner, admin, member e viewer:
    - lista e contador só com as próprias notificações;
    - `read` e `read-all` com o id de outra pessoa dão o mesmo 404 de um id inexistente (corpo idêntico, sem `requestId`/`instance`);
    - nada marcado no banco;
    - `read-all` marca só quem chamou e só na organização ativa (conferido no banco);
    - a própria notificação de B pelo caminho de A ⇒ 404 idêntico; pelo caminho de B funciona;
    - a atribuição via HTTP grava `tasks.assignee_changed` na outbox (ADR 0017).
- **Testes**: 7 novos. `api:integration-test`: 63 de 63 (9 arquivos).
- **Mutation testing**: 5 mutantes no repositório Prisma, 5 mortos: sem destinatário em `markAllRead`, `page`, `recentUnread` e `findOwn`; sem organização em `findOwn`. A base do mesmo comando passa (7/7).
- **Gate**: `pnpm nx affected -t lint typecheck test --base=HEAD` exit 0 (33 projetos).
