# 005 — Kanban · Design técnico

- **Status**: Aprovado (revisão 2; D1–D6 como recomendados)
- **Requisitos**: [requirements.md](requirements.md)
- **Revisão de arquitetura**: feita (revisão 2 incorpora os achados: B1, B2, I1–I9, S1–S9)
- **Revisão de segurança**: feita (revisão 2 incorpora os achados: A1, M1–M3, B1–B8)

## Solução proposta

**O quadro é uma visão de `tasks`** (D1, [ADR 0016](../../docs/architecture/adr/0016-kanban-board-as-tasks-view.md), proposto). Com um quadro por projeto e coluna = status (decisão 1), o único estado próprio do quadro seria a posição do card. Mantê-la num contexto `boards` exigiria ordenar tarefas por dado de outro contexto — junção entre tabelas de contextos ou **cópia** do status e do "é card" em `boards`, sincronizada em toda escrita de `tasks` (portas nos dois sentidos, duas fontes da verdade, transação compartilhada). Proposta: a posição vira a coluna `tasks.board_rank`, os casos de uso do quadro vivem em `tasks` (dono do status e de `TransitionTask`), e o contexto **`boards` fica adiado** até ter estado próprio (vários quadros, WIP, raias, colunas que não são 1:1 com status). O ADR 0016 **substitui a "Exceção conhecida" Tasks × Boards do ADR 0003** (não há mais fronteira transacional compartilhada).

**Workflow configurável em `projects`** (dono de `workflow_statuses`/`workflow_transitions` desde a 003): casos de uso de edição sobre `lockProjectAndRereadActor` (organização `FOR SHARE`, projeto `FOR NO KEY UPDATE`, ator relido — obrigação 1 da 004), versão própria (`projects.workflow_version`, BR-008) e a porta **`WorkflowStatusUsage`** em `projects/application` (`statusUsage(org, project) → Map<statusId, count>`; `reassignStatus(org, project, from, to) → count`), na direção já existente `projects → tasks`.

**Ordenação** (BR-009, [ADR 0007](../../docs/architecture/adr/0007-kanban-ordering.md) → Aceito): chave fracionária própria em `tasks/domain` (decisão 8) com **parte inteira de tamanho variável** (B1): acrescentar no fim ou no início cresce em O(log₆₂ n); só inserções repetidas no mesmo ponto do meio crescem rápido, e essas acontecem apenas em `MoveCard`, que pode rebalancear. Ordem total `(board_rank, id)`, collation `"C"`.

**Mover card** (`MoveCard`, em `tasks`): um único `lockTaskForWrite` com o lock do projeto em `tasks` (D3); quando a coluna muda, aplica o núcleo extraído `applyTransition` (S1: BR-004, BR-001, BR-006, versão); a chave nova é gravada por método próprio do repositório (fora do agregado `Task`, S2).

## Componentes envolvidos

| Projeto Nx                           | Camada         | Mudança                                                                                                                                                                                                                                                         |
| ------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/tasks/domain`          | domain         | `board/rank.ts` (`keyBetween`, `keyAfter`, `keyBefore`, `spreadKeys`, `isValidRank`, `needsRebalance`; sem `localeCompare`); `InvalidPositionError`, `TaskNotACardError`                                                                                        |
| `libs/backend/tasks/application`     | application    | `GetBoard`, `ListColumnCards`, `MoveCard` (núcleo + casca); `applyTransition` extraído de `TransitionTask`; `CreateTask`, `TransitionTask` e `ReopenTask` põem o card no fim da coluna; `CountTasksByStatus`, `ReassignTasksStatus` (fundação, só repositórios) |
| `libs/backend/tasks/infrastructure`  | infrastructure | `board_rank`: página da coluna por keyset `(rank, id)`, último/primeiro da coluna, vizinhos, `placeCard`, `appendToColumn`, `rebalanceColumn` (UPDATE parametrizado), `countByStatus` (`groupBy`), `reassignStatus` (`updateMany`)                              |
| `libs/backend/tasks/http`            | presentation   | `GET /board`, `GET /board/columns/{statusId}`, `POST /tasks/{taskId}/move`, erros, OpenAPI                                                                                                                                                                      |
| `libs/backend/projects/domain`       | domain         | `Workflow` editável (BR-030) e erros                                                                                                                                                                                                                            |
| `libs/backend/projects/application`  | application    | Casos de uso do workflow, porta `WorkflowStatusUsage`, `GetWorkflow` com versão e "em uso"                                                                                                                                                                      |
| `libs/backend/projects/{infra,http}` | infra/http     | Persistência do workflow (posições reescritas `0..n−1`, filtros `(org, project, id)` em toda escrita), rotas, OpenAPI                                                                                                                                           |
| `libs/contracts`                     | contracts      | `board.contract.ts`; `workflowSchema` com `version` e `inUse`; comandos de workflow (`strictObject`, listas limitadas)                                                                                                                                          |
| `prisma`                             | —              | `tasks.board_rank` (collation `"C"`, backfill, CHECK, índice substituindo o de status), `projects.workflow_version`, índice único `lower(name)` (SQL manual)                                                                                                    |
| `apps/api`                           | app            | `createWorkflowStatusUsage(tasksFoundation)`; ordem de montagem; harness com referências em listas e aninhadas; baterias; concorrência                                                                                                                          |
| `apps/web`, `apps/web-e2e`           | app/e2e        | Aba "Quadro" (CDK drag-drop + teclado), "Fluxo de trabalho" nas configurações; jornada real                                                                                                                                                                     |

### Ordem de montagem em `apps/api` (I2)

1. `createTasksFoundation` — repositórios, `RevokeAssignmentsOnAccessLoss`, **`CountTasksByStatus` e `ReassignTasksStatus`** (só repositórios de `tasks` e relógio);
2. `createProjectsFoundation({ contributorChanges, workflowStatusUsage: createWorkflowStatusUsage(tasksFoundation) })`;
3. `createOrganizationsModule`; 4. `createProjectsModule` (casos de uso do workflow); 5. `createTasksModule` (quadro e movimento).

A cadeia de reações continua linear (`organizations → projects → tasks`); `tasks → projects` só por `ProjectAccess`.

## Fluxo de dados

```mermaid
sequenceDiagram
    participant UI
    participant API as tasks/http
    participant MC as MoveCard (tasks)
    participant PA as ProjectAccess (projects)
    participant DB
    UI->>API: POST /tasks/{id}/move {toStatusId, afterTaskId|beforeTaskId, version}
    API->>MC: execute (limite, lock_timeout 2 s)
    MC->>PA: lockForContribution (projeto FOR SHARE, memberships FOR SHARE, workflow relido)
    MC->>DB: task_project_locks FOR UPDATE → tarefa FOR NO KEY UPDATE
    alt coluna nova
        MC->>MC: applyTransition (BR-004, BR-001, BR-006, versão)
    end
    MC->>DB: par (anterior, sucessor) na coluna → keyBetween; empate ou > 32 ⇒ rebalanceColumn e recalcula
    MC-->>API: card + statusId; eventos após o commit
```

## Modelo de domínio

- **Chave de posição** (`tasks/domain/board/rank.ts`), esquema conhecido do _fractional indexing_ implementado à mão:
  - alfabeto base 62 `0-9A-Za-z` em ordem ASCII; a chave = **cabeça** (letra que codifica o tamanho da parte inteira: `a`…`z` = 1…26 dígitos positivos; `Z`…`A` = negativos) + parte inteira + parte fracionária opcional que nunca termina em `0`;
  - `keyAfter(k)` incrementa a parte inteira (crescimento logarítmico); `keyBefore(k)` decrementa; `keyBetween(a, b)` exige `a < b` (senão lança `RankOrderError`, interno) e usa a parte fracionária; `spreadKeys(n)` gera `n` chaves espaçadas para rebalancear; `needsRebalance(k)` ⇔ tamanho > 32.
  - Comparação só por `<`/`>` de string (código ASCII) — nunca `localeCompare` (teste dedicado).
  - Testes de propriedade: ordem preservada; determinismo; 10 000 acréscimos e 10 000 inserções no topo sempre ≤ 32 caracteres; inserções repetidas no meio crescem e sinalizam rebalanceamento.
- **Coluna**: cards = tarefas de primeiro nível não canceladas do status, por `(rank, id)`. `subtasks = { done, total }` **sem** canceladas.
- **Workflow** (`projects/domain`, BR-030): nomes 1–40 em texto exibível (`normalizeDisplayText`: sem caracteres de controle nem de direção bidi), únicos sem diferenciar maiúsculas; ≥ 1 status `todo`; teto de 20 status; categoria só muda em status **sem nenhuma tarefa** (canceladas e subtarefas contam, I4/M3); remover: `moveTasksTo` opcional se o status está vazio, obrigatório se tem tarefas, distinto e **da mesma categoria** (D2); o único status de uma categoria com tarefas não pode ser removido; transições entre status distintos do workflow, sem duplicatas; reordenar exige a lista com **exatamente** os status do workflow relido.
  - Erros: `INVALID_STATUS_NAME` (400), `STATUS_NAME_TAKEN` (409), `STATUS_NOT_FOUND` (404), `STATUS_IN_USE` (409), `INVALID_STATUS_TARGET` (422), `WORKFLOW_NEEDS_TODO_STATUS` (422), `STATUS_LIMIT_REACHED` (422), `INVALID_STATUS_ORDER` (422), `INVALID_TRANSITION` (422).

## Modelagem de dados

Uma migration aditiva:

| Tabela              | Mudança                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks`             | `board_rank text COLLATE "C" NOT NULL` com backfill `'e' \|\| lpad(number::text, 5, '0')` (crescente pelo número: a mais nova no fim, coerente com RF-11); CHECK de alfabeto e tamanho ≤ 64; índice **não único** `(organization_id, project_id, status_id, board_rank, id)` **substituindo** `(organization_id, project_id, status_id)`. Não único de propósito: um índice único faria todo `UPDATE` da chave tomar `FOR UPDATE` em vez de `FOR NO KEY UPDATE`, em conflito com o `FOR KEY SHARE` das FKs de subtarefa e de dependência (B2) |
| `projects`          | `workflow_version int NOT NULL DEFAULT 1` (fora de `Project.save()`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `workflow_statuses` | índice único `(organization_id, project_id, lower(name))` (SQL manual). Posição continua **não única** (obrigação 4 da 003, I5): toda edição reescreve `0..n−1` sob o `FOR NO KEY UPDATE` do projeto; leitura por `(position, id)`                                                                                                                                                                                                                                                                                                            |

Proteções (I9, B7): teste de catálogo da collation `"C"` (`information_schema.columns.collation_name`) e do índice funcional; teste de ordenação com chaves de maiúsculas e minúsculas; `migrate diff` vazio depois dos ajustes manuais; comentários nos modelos apontando os testes. `P2002`/`23505` do índice ⇒ `STATUS_NAME_TAKEN`; `P2003`/`23503` da FK `RESTRICT` no `DELETE` ⇒ `STATUS_IN_USE` (nunca 500).

## Contratos

Sob `/api/v1/organizations/{organizationId}`.

| Método | URI                                                                              | Permissão         | Request                                                            | Response                                                                                                   |
| ------ | -------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| GET    | `/board?projectId&limit` (padrão 25, máx. 50 por coluna)                         | `project:read`    | —                                                                  | `{ workflow: Workflow, columns: [{ statusId, cards: Card[], nextCursor }], actions: { move, configure } }` |
| GET    | `/board/columns/{statusId}?projectId&cursor&limit` (padrão 50, máx. 100)         | `project:read`    | —                                                                  | `{ cards: Card[], nextCursor }`                                                                            |
| POST   | `/tasks/{taskId}/move`                                                           | `task:update`     | `{ toStatusId, afterTaskId? \| beforeTaskId?, version }`           | `{ card: Card, statusId }`                                                                                 |
| GET    | `/projects/{projectId}/workflow`                                                 | `project:read`    | —                                                                  | `Workflow` (`version`; `inUse` por status)                                                                 |
| POST   | `/projects/{projectId}/workflow/statuses`                                        | `board:configure` | `{ name, category, version }`                                      | 201 `Workflow`                                                                                             |
| PATCH  | `/projects/{projectId}/workflow/statuses/{statusId}`                             | `board:configure` | `{ name?, category?, version }` (≥ 1 campo)                        | `Workflow`                                                                                                 |
| DELETE | `/projects/{projectId}/workflow/statuses/{statusId}?moveTasksToStatusId&version` | `board:configure` | —                                                                  | `Workflow`                                                                                                 |
| PUT    | `/projects/{projectId}/workflow/order`                                           | `board:configure` | `{ statusIds: uuid[] (≤ 20), version }`                            | `Workflow`                                                                                                 |
| PUT    | `/projects/{projectId}/workflow/transitions`                                     | `board:configure` | `{ transitions: [{ fromStatusId, toStatusId }] (≤ 380), version }` | `Workflow`                                                                                                 |

- **Card** = `TaskSummary` da 004 + `subtasks: { done, total }`. Destinos possíveis vêm de `workflow.transitions` + `actions.move` (sem lista por card, S4: `task:update` não tem `own`).
- **Movimento**: sem vizinho ⇒ fim da coluna; os dois juntos ⇒ 400. O servidor resolve o **par** (anterior, sucessor) na ordem `(rank, id)` numa consulta filtrada por `(organization_id, project_id, status_id = toStatusId, parent_task_id IS NULL, canceled_at IS NULL, id)`; vizinho que não está nesse conjunto (inexistente, outro projeto ou organização, outra coluna, subtarefa, cancelado, o próprio card) ⇒ `INVALID_POSITION` (422) com o mesmo corpo em todos os casos (B2 da segurança). Empate de chaves no par ou chave nova > 32 ⇒ rebalanceamento e novo cálculo, nunca erro (B2/M2).
- **Ordem de decisão do movimento**: 404 uniforme `TASK_NOT_FOUND` → 403 → `PROJECT_ARCHIVED` → `TASK_CANCELED` → `VERSION_CONFLICT` → `TASK_NOT_A_CARD` (422, subtarefa — I8/B1) → `STATUS_NOT_FOUND` → `INVALID_POSITION` → regras (BR-004, BR-001, BR-006).
- **Versão**: a da tarefa, sempre conferida; incrementada só quando o status muda (D4).
- **Coluna paginada**: `statusId` conferido no workflow do projeto já resolvido (senão `STATUS_NOT_FOUND`), depois de `PROJECT_NOT_FOUND`; cursor opaco `(statusId, rank, id)` validado na decodificação (rank válido ≤ 64, UUIDs; amarrado ao `statusId`): malformado ⇒ 400, sem chegar ao banco (B3).
- **Workflow**: 404 `PROJECT_NOT_FOUND` → 403 → `PROJECT_ARCHIVED` → `VERSION_CONFLICT` → **referências**: qualquer status fora do workflow relido (de outro projeto, de outra organização ou inexistente) em `statusId`, `statusIds[]`, `transitions[]` ou `moveTasksToStatusId` ⇒ 404 `STATUS_NOT_FOUND`, verificado antes das regras → regras BR-030 → limites (A1). A reordenação só grava se o conjunto pedido for igual ao relido, e cada `UPDATE` filtra `(organization_id, project_id, id)`.

**Eventos** (log, só ids, após o commit): `tasks.card_moved` (de/para status; sem a chave); `tasks.status_changed` quando a coluna muda; `projects.workflow_changed` (tipo; contagem de tarefas reatribuídas). Tarefas reatribuídas pela remoção de status **não** emitem `tasks.status_changed`: a evidência é `projects.workflow_changed` (como a revogação da 004) — obrigação registrada para as specs 008/009 (S7).

## Segurança

- Matriz da 006 sobre o papel efetivo relido sob lock: mover = `task:update`; configurar = `board:configure` (via `lockProjectAndRereadActor`). Quem não participa ⇒ 404 idêntico a "não existe"; sem permissão ⇒ 403 antes de erros de estado. `actions.move`/`actions.configure` devolvidas pela API.
- **Harness (A1)**: `inputReferences` passa a percorrer **arrays e objetos aninhados** (`statusIds[]`, `transitions[].fromStatusId/toStatusId`) e o parâmetro de destino chama-se `moveTasksToStatusId` (termina em `Id`); teste unitário falha se faltar variante para qualquer um. Expectativas: listas e `moveTasksToStatusId` com status de B ou de outro projeto ⇒ 404 `STATUS_NOT_FOUND`; vizinhos ⇒ `refused` 422 `INVALID_POSITION`; cursor de B ⇒ `no-leak`. Bateria intra-tenant com os mesmos ids de outro projeto.
- **Abuso**: movimentos contam em `tasks.write.user.hour` (1200); edições de workflow em `projects.workflow.write.user.hour` (120); **rebalanceamento** limitado por projeto (`tasks.rebalance.project.hour`, 30; excedido ⇒ o movimento responde 429 sem reescrever) e raro pelo esquema de chaves (M1); teto de 20 status; listas limitadas no contrato; `GET /board` com no máximo 50 cards por coluna (B4); `lock_timeout` de 2 s **também** nas escritas de workflow (B8).
- A chave de posição é calculada só no servidor e não aparece em eventos.
- Frontend (B6): nomes e mensagens só por interpolação do Angular; o movimento otimista é revertido em qualquer recusa (teste).

## Concorrência e consistência

**Ordem única de locks** (estende a da 004): projeto (`projects`) `FOR SHARE` → memberships `FOR SHARE` → lock do projeto em `tasks` → **uma** linha de `tasks`; no rebalanceamento, depois do lock do projeto em `tasks`, as linhas da coluna travadas em ordem de `id` (`SELECT … ORDER BY id FOR NO KEY UPDATE`) e reescritas num `UPDATE … FROM unnest($ids, $ranks)` parametrizado, filtrado por `(organization_id, project_id, status_id)` — primeira **escrita** em SQL raw tenant-scoped: gatilho do ADR 0014 avaliado no ADR 0007 (mantém o RLS adiado; coberto pelo snapshot do harness).

- **Movimento × movimento**: serializados pelo lock do projeto em `tasks` (D3); dois cards soltos no mesmo ponto recebem chaves distintas.
- **Acréscimo no fim sem o lock** (criação de primeiro nível, transição pelo detalhe sem `done`, reabertura — I7): pode empatar com outro acréscimo ou com um movimento para o fim; desempate por `id` (BR-009) e o par empatado é resolvido no próximo movimento (B2). Um acréscimo que leu o "último" antes de um rebalanceamento pode cair no meio da coluna: nenhum card se perde e a ordem segue total (efeito aceito, I6).
- **Workflow × escrita de tarefa**: edições do workflow travam o projeto `FOR NO KEY UPDATE` (conflito com o `FOR SHARE`); todo movimento relê o workflow depois do lock. Quem chega depois recebe `STATUS_NOT_FOUND`, `TRANSITION_NOT_ALLOWED` ou `VERSION_CONFLICT`.
- **Remoção de status**: contar (todas as tarefas) + reatribuir (`updateMany` de `status_id` com `version + 1`, **mantendo a chave**: as tarefas se intercalam com as do destino preservando a ordem relativa de cada lista — I3) + apagar, tudo sob o `FOR NO KEY UPDATE`. D2 (mesma categoria) dispensa o lock do projeto em `tasks`: nenhuma tarefa entra ou sai de `done`. Risco aceito: até 10 000 linhas reatribuídas seguram as escritas do projeto (que recebem 409 depois de 2 s), restrito a gerentes e ao limite de 120/h (B8).
- **Leitura do quadro**: até 20 consultas de coluna fora de transação podem mostrar um card em duas colunas, ou em nenhuma, durante um movimento; aceito (o cliente recarrega depois de cada movimento próprio e em "Atualizar"), S5.
- Runner: READ COMMITTED, uma repetição em `P2034`, `lock_timeout` de 2 s.

**Testes de concorrência** (S9): movimentos simultâneos ao mesmo ponto; movimento × remoção da coluna destino; movimento × substituição das transições; acréscimo pelo detalhe × movimento para o fim (empate forçado); rebalanceamento × acréscimo; mudança de categoria × criação de tarefa; cascata da exclusão da organização (obrigação 5 da 004).

## Transição das obrigações

- **Da 004**: (1) mover chama o núcleo de transição **dentro de `tasks`** (D1), eventos depois do commit da casca de `MoveCard` — forma nova; (2) edição do workflow trava o projeto `FOR NO KEY UPDATE` ✔; (3) "recalcular `completed_at` ao mudar categoria em uso" **substituída** pela decisão 3 (categoria só em status sem tarefas) — registrar na revisão do design da 004; (4) remover status em uso exige migrar ✔ (D2); (5) cascata da organização testada ✔.
- **Da 003**: obrigação 4 (unicidade da ordem) decidida: posição não única, reescrita sob lock (I5).
- **Para 007/008/009**: o espaço global de chaves serve a quadros filtrados (sprint) sem estado novo; reatribuições por remoção de status não emitem eventos de tarefa (S7).

## Frontend

- Aba "Quadro" (`/o/:slug/projects/:key/board`), entre "Visão geral" e "Tarefas": colunas com rolagem horizontal, cards (chave, título, prioridade, responsável, prazo, subtarefas `2/3`), "carregar mais" por coluna, "Atualizar"; aviso em coluna sem transição de saída.
- `@angular/cdk/drag-drop`; **alternativa por teclado**: menu de ações por card ("Mover para…" com as colunas permitidas, "Para cima", "Para baixo"); resultado em `aria-live`; foco volta ao card. Otimista com reversão e mensagem da regra (chaves dos ids de BR-001/BR-006).
- Configurações → "Fluxo de trabalho": status (criar, renomear, categoria só quando vazio, subir/descer, remover com destino da mesma categoria) e matriz de transições (caixas rotuladas origem × destino). Ações só com `actions.configure`.

## Observabilidade

Eventos acima no log estruturado; contagem de rebalanceamentos e de `CONCURRENT_UPDATE` por `lock_timeout` como métricas futuras (Fase 4).

## Decisões arquiteturais

| Decisão                         | Alternativas                                                         | Escolha e motivo                                                                                                                    | ADR                                        |
| ------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Onde vive o quadro (D1)         | `boards` com tabela de cards (status espelhado); `boards` sem estado | **Visão de `tasks`**: uma fonte da verdade, uma linha por movimento, sem portas novas nem transação compartilhada                   | 0016 (proposto; substitui exceção do 0003) |
| Ordenação                       | Inteiro sequencial; decimal; biblioteca                              | **Chave fracionária própria** com parte inteira variável, base 62, collation `"C"`, rebalanceamento só no movimento                 | 0007 → Aceito                              |
| Concorrência de movimentos (D3) | Lock do vizinho; sem lock                                            | **Lock do projeto em `tasks`** em todo movimento                                                                                    | —                                          |
| Versão no movimento (D4)        | Reordenar incrementa                                                 | **Sempre conferida; incrementada só ao mudar de coluna**; chave fora do agregado                                                    | —                                          |
| Reatribuição ao remover (D2)    | Qualquer categoria com recálculo                                     | **Mesma categoria**, `updateMany` mantendo a chave                                                                                  | —                                          |
| Versão do workflow              | `projects.version`                                                   | **`workflow_version`** (editar o nome do projeto não conflita com o fluxo; substituição total das transições não perde atualização) | —                                          |
| Rebalanceamento                 | Janela local; N `update`s                                            | **Coluna inteira, raro, `UPDATE … FROM unnest` parametrizado**, limitado por projeto                                                | 0007                                       |

## Decisões para aprovação

- **D1** — Quadro como visão de `tasks`; `boards` adiado (ADR 0016, substitui a exceção do ADR 0003) — recomendado (revisão de arquitetura: aprovado).
- **D2** — Remover status com tarefas reatribui para outro status **da mesma categoria**, mantendo a posição relativa — recomendado.
- **D3** — Todo movimento trava o projeto em `tasks` (movimentos de um projeto em série) — recomendado.
- **D4** — Versão da tarefa conferida em todo movimento, incrementada só ao mudar de coluna — recomendado.
- **D5** — Limites: 20 status por projeto; quadro com 25 cards por coluna (máx. 50) e coluna paginada com 50 (máx. 100); 120 edições de workflow por hora por usuário; 30 rebalanceamentos por projeto por hora; movimentos nas 1200 escritas de tarefa por hora.
- **D6** — Cancelada reaberta e tarefa movida pelo detalhe vão para o **fim** da coluna (em vez de voltar à posição antiga) — recomendado.

## Riscos

| Risco                                           | Probabilidade | Impacto | Mitigação                                                                                           |
| ----------------------------------------------- | ------------- | ------- | --------------------------------------------------------------------------------------------------- |
| Chaves crescendo em inserções repetidas no meio | Média         | Baixo   | Parte inteira variável; rebalanceamento > 32 só no movimento; CHECK ≤ 64; limite por projeto        |
| Collation `"C"` ou índice funcional perdidos    | Média         | Médio   | Testes de catálogo, teste de ordenação maiúsculas/minúsculas, `migrate diff` vazio, comentários     |
| Escrita raw tenant-scoped (rebalanceamento)     | Baixa         | Alto    | Método único filtrado por organização, projeto e status; snapshot do harness; avaliação no ADR 0007 |
| Contenção do lock do projeto em `tasks`         | Baixa         | Médio   | Ritmo humano; `lock_timeout` 2 s ⇒ 409 recuperável                                                  |
| Remoção de status grande segurando o projeto    | Baixa         | Médio   | Só gerentes, 120/h; aceito                                                                          |

## Histórico de revisões

| Revisão | Origem                  | Mudanças principais                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Autor                   | Versão inicial                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2       | Arquitetura e segurança | Chave com parte inteira variável e backfill `'e'+5 dígitos`; empate resolvido no movimento; índice não único; rebalanceamento por UPDATE parametrizado, limitado e avaliado no ADR 0014; harness com listas e aninhados (`moveTasksToStatusId`); referências de status ⇒ 404 antes das regras; reordenação conferida com o workflow relido; "em uso" conta todas as tarefas; reatribuição mantendo a chave; `TASK_NOT_A_CARD`; reabrir vai para o fim; ordem de montagem; ADR 0016 substitui a exceção do ADR 0003; limites do quadro; proteções de collation e índice; obrigações da 003/004 |
