# 005 — Kanban · Tarefas

Regras: uma tarefa por vez; marcar `[x]` somente com evidência executada (seção abaixo). Toda tarefa termina com `pnpm nx affected -t lint typecheck test` passando; tarefas com persistência, portas entre contextos ou harness também com `pnpm test:integration`. Mutation testing manual registrado por tarefa.

## Bloco A — Domínio e persistência

| ID  | Tarefa                                                                                                                                                                                                                                                                                                          | Depende de | Verificação                                                                                                                                               | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T1  | `tasks/domain`: chave de posição com parte inteira variável (`keyAfter`, `keyBefore`, `keyBetween`, `spreadKeys`, `isValidRank`, `needsRebalance`; sem `localeCompare`), `INVALID_POSITION`, `TASK_NOT_A_CARD`; ADR 0007 → Aceito (com a avaliação do gatilho do ADR 0014)                                      | —          | testes de propriedade (ordem, determinismo, 10 000 acréscimos e inserções no topo ≤ 32, meio sinaliza rebalanceamento)                                    | [x]    |
| T2  | `projects/domain`: workflow editável (BR-030: criar, renomear, categoria, reordenar, remover com destino, transições) e erros                                                                                                                                                                                   | —          | testes de domínio nomeados BR-030                                                                                                                         | [x]    |
| T3  | Prisma + migration: `tasks.board_rank` (collation `"C"`, backfill `'e'+5 dígitos`, CHECK, índice não único substituindo o de status), `projects.workflow_version`, índice único `lower(name)` manual                                                                                                            | T1         | integração: backfill crescente pelo número, CHECK, catálogo da collation e do índice funcional, ordenação com maiúsculas/minúsculas, `migrate diff` vazio | [x]    |
| T4  | Repositórios: `tasks` (coluna por keyset `(rank, id)`, último/primeiro, par de vizinhos, `placeCard`, `appendToColumn`, `rebalanceColumn` raw parametrizado com linhas travadas por `id`, `countByStatus`, `reassignStatus`); `projects` (workflow com versão, posições `0..n−1`, filtros `(org, project, id)`) | T3         | integração dos repositórios                                                                                                                               | [x]    |

## Bloco B — Aplicação

| ID  | Tarefa                                                                                                                                                                                                                                                                                                      | Depende de | Verificação                                           | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------- | ------ |
| T5  | `tasks/application`: `applyTransition` extraído; `GetBoard`, `ListColumnCards`, `MoveCard` (núcleo + casca, empate e rebalanceamento limitado); `CreateTask`/`TransitionTask`/`ReopenTask` põem o card no fim; `CountTasksByStatus`, `ReassignTasksStatus` na fundação                                      | T1, T4     | fakes: CA-01 a CA-04, CA-06 (mover), ordem de decisão | [x]    |
| T6  | `projects/application`: casos de uso do workflow (lock do projeto `FOR NO KEY UPDATE`, `board:configure`, `workflow_version`, porta `WorkflowStatusUsage`); `GetWorkflow` com versão e "em uso"                                                                                                             | T2, T4     | fakes: CA-05, CA-06 (configurar), ordem de decisão    | [x]    |
| T7  | Composição em `apps/api` (`createWorkflowStatusUsage(tasksFoundation)`, ordem de montagem); integração concorrente: mesmo ponto, movimento × remoção da coluna, movimento × transições, acréscimo × movimento para o fim (empate), rebalanceamento × acréscimo, categoria × criação; cascata da organização | T5, T6     | integração: CA-02, CA-07, RNF-02                      | [x]    |

## Bloco C — HTTP, isolamento e autorização

| ID  | Tarefa                                                                                                                                                                                                                                                              | Depende de | Verificação                                            | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------ | ------ |
| T8  | Contratos (`board.contract.ts`, workflow), routers de `tasks` e `projects`, erros, limites, OpenAPI                                                                                                                                                                 | T7         | Supertest: contratos, 400/403/404/409/422/429; OpenAPI | [ ]    |
| T9  | Harness: `inputReferences` percorre listas e objetos aninhados (teste unitário de falha); casos das rotas novas (`statusIds[]`, `transitions[]`, `moveTasksToStatusId`, vizinhos `refused`, cursor); baterias intra-tenant (quadro e workflow, IDOR entre projetos) | T8         | integração (CA-08); lacunas fazem falhar               | [ ]    |

## Bloco D — Frontend e jornada

| ID  | Tarefa                                                                                                                                      | Depende de | Verificação                     | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------- | ------ |
| T10 | Aba "Quadro": colunas, cards, carregar mais, atualizar, arrastar e soltar (CDK) com alternativa por teclado, mensagens das regras, reversão | T8         | testes de componente (CA-09)    | [ ]    |
| T11 | Configurações → "Fluxo de trabalho": status (criar, renomear, categoria, ordem, remover com destino) e matriz de transições                 | T8         | testes de componente            | [ ]    |
| T12 | E2E real (continua a jornada de projetos e tarefas): coluna nova, transições, mover cards, recusa de conclusão                              | T10, T11   | Playwright no banco descartável | [ ]    |

## Bloco E — Documentação e validação

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                                                                     | Depende de | Verificação                                                           | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- | ------ |
| T13 | ADR 0016 aceito e ADR 0003 com a exceção substituída; `bounded-contexts.md` (Boards adiado), `data-flow.md` (rota real; Socket.IO planejado), `dependency-rules.md`, `business-rules.md` (BR-004 e BR-009 sem Boards e sem tempo real, BR-030), `authorization.md`, `multi-tenancy.md`, `testing.md`; revisão do design da 004 (obrigação 3 substituída); índice e roadmap | T1–T12     | verificação de links                                                  | [ ]    |
| T14 | `/review-code` e `/security-audit`; correções; gate final                                                                                                                                                                                                                                                                                                                  | T13        | sem bloqueantes / sem Críticos-Altos; `pnpm verify`, integração e E2E | [ ]    |

## Evidências

### T1 — 2026-10-14

- **Entregue**:
  - `libs/backend/tasks/domain/src/lib/board/rank.ts`: chave fracionária com parte inteira de tamanho variável (cabeça `a`…`z`/`Z`…`A`), base 62 em ordem ASCII; `keyBetween` (exige `a < b`; empate ou inversão ⇒ `RankOrderError` interno), `keyAfter`, `keyBefore`, `spreadKeys`, `isValidRank` (alfabeto, cabeça, sem fração terminando em `0`, ≤ 64), `needsRebalance` (> 32); sem `localeCompare`.
  - Erros de domínio `INVALID_POSITION` e `TASK_NOT_A_CARD`.
  - ADR 0007 **Aceito**: formato, comparação, empates, rebalanceamento por `UPDATE … FROM unnest` e a avaliação do gatilho do ADR 0014 (RLS continua adiado, com os motivos).
- **Testes**: 10 novos (36 no projeto):
  - ordem e determinismo; chaves do backfill (`e` + 5 dígitos) válidas e crescentes;
  - **10 000 acréscimos e 10 000 inserções no topo ≤ 32 caracteres**; inserções repetidas no meio sinalizam rebalanceamento exatamente ao passar de 32;
  - propriedade com 3 000 inserções aleatórias (gerador determinístico): lista estritamente crescente, válida e sem repetição;
  - `spreadKeys(10 000)` curtas; empate e inversão lançam; validação; ordem por código (maiúsculas antes de minúsculas) e ausência de `localeCompare`.
- **Mutation testing**, 8/8 detectados. O sobrevivente da primeira rodada (limiar de rebalanceamento) virou asserção de fronteira.
- **Gate**: a primeira rodada falhou de propósito no teste de paridade da 004 (`tasks/http`: todo código de erro com mapeamento HTTP); mapeados `INVALID_POSITION` e `TASK_NOT_A_CARD` (422). Depois: `nx affected -t lint typecheck test` ✔.

### T2 — 2026-10-14

- **Entregue** em `libs/backend/projects/domain/src/lib/workflow/workflow-editing.ts` (funções puras; quem chama relê o workflow e o uso sob lock e grava o resultado):
  - `addStatus` (fim, sem transições), `renameStatus`, `changeCategory` (só sem tarefas; sempre sobra `todo`), `reorderStatuses` (exatamente os status do workflow), `removeStatus` (destino opcional se vazio; com tarefas, distinto e da mesma categoria — D2; transições do status caem junto; devolve o destino efetivo), `replaceTransitions` (pares distintos, sem repetição);
  - nomes por `normalizeDisplayText` (1–40, sem controle nem bidi), únicos sem diferenciar maiúsculas; teto de 20 status; posições reescritas `0..n−1`;
  - **referências antes das regras** (achado A1): id fora do workflow em qualquer parâmetro ou lista ⇒ `STATUS_NOT_FOUND`, antes de `INVALID_STATUS_ORDER`/`INVALID_TRANSITION`;
  - 9 erros novos (`INVALID_STATUS_NAME`, `STATUS_NAME_TAKEN`, `STATUS_NOT_FOUND`, `STATUS_IN_USE`, `INVALID_STATUS_TARGET`, `WORKFLOW_NEEDS_TODO_STATUS`, `STATUS_LIMIT_REACHED`, `INVALID_STATUS_ORDER`, `INVALID_TRANSITION`); o mapeamento HTTP entra na T8.
- **Testes**: 9 novos (48 no projeto), nomeados BR-030, cobrindo cada regra, a ordem 404 → regra e o caractere bidi.
- **Mutation testing**: 11/11 detectados.
- **Comandos**: `nx affected -t lint typecheck test` ✔.

### T3 — 2026-10-14

- **Entregue**:
  - Modelos: `Task.boardRank` (comentário apontando os testes) e índice `(org, project, status, board_rank, id)` **não único** no lugar do índice por status; `Project.workflowVersion`.
  - Migration `20261014220000_add_kanban`, escrita à mão a partir do SQL do Prisma: `board_rank text COLLATE "C"` anulável → backfill `'e' || lpad(number, 5, '0')` → `NOT NULL`; CHECK de alfabeto e tamanho (2–64); troca de índice; `workflow_version`; índice único `(organization_id, project_id, lower(name))`.
  - **`prisma migrate diff`** do banco migrado para o schema ⇒ **vazio** (o Prisma não enxerga collation nem índice de expressão: por isso os testes de catálogo).
  - Aplicada ao `taskflow_e2e` (`prisma migrate deploy`); o backfill conferiu nas 6 tarefas existentes (`board_rank = 'e' || lpad(number, 5, '0')`: 6/6). **O banco de desenvolvimento precisa de `pnpm db:migrate`.**
  - Para compilar com a coluna obrigatória (antecipado da T4/T5): `TaskRepository.add(task, boardRank)` e `lastRankInColumn`; `CreateTask` põe o card no fim da coluna inicial (`keyAfter`, sem lock; empate ⇒ `id`). Fake com as chaves fora do agregado.
- **Testes** (`tasks-schema.integration.spec.ts`, 5 novos, 19 no projeto): catálogo da collation `"C"`; catálogo dos índices (coluna não único, índice antigo removido, `lower(name)` único); ordenação ASCII no banco (`a0 < aB < aZ < aa < ab`); CHECK (alfabeto, tamanho; empates permitidos); nome de status único sem diferenciar maiúsculas por projeto; `workflow_version = 1`.
- **Mutation testing** sobre a migration, 4/4 detectados: sem collation; sem CHECK; índice da coluna único; sem índice `lower(name)`.
- **Regressão**: `pnpm test:integration` ✔ em 7 projetos (identity 50, shared 33, organizations 33, projects 21, tasks 19, worker 9, api 37). **Comandos**: `nx affected -t lint typecheck test` ✔ (13 projetos).

### T4 — 2026-10-14

- **Entregue**:
  - `TaskRepository` (interface, Prisma e fake):
    - `lastRankInColumn` (com exceção do card em movimento), `columnPage` (keyset `(rank, id)`, só cards);
    - `subtaskCounts` (dois `groupBy`, sem canceladas), `cardInColumn` (uma consulta com o filtro completo), `adjacentCard` (vizinho imediato, ignora o card em movimento);
    - `placeCard` (só a chave, sem versão — D4), `rebalanceColumn` (trava as linhas em ordem de `id`, `spreadKeys`, um `UPDATE … FROM unnest` parametrizado e filtrado por organização, projeto e status);
    - `countByStatus` (todas as tarefas), `reassignStatus` (`updateMany` mantendo a chave, `version + 1`).
  - `ProjectRepository`: `workflowVersion` e `saveWorkflow` (versão conferida e incrementada; remove ausentes com transições em cascata, atualiza existentes, cria novos, substitui transições; toda escrita filtra `(org, project, id)`; `P2002` ⇒ `STATUS_NAME_TAKEN`, `P2003` ⇒ `STATUS_IN_USE`). Atualizações por status em laço limitado pelo teto de 20.
- **Testes**: tasks 5 novos (24 no projeto); projects 3 novos (24 no projeto):
  - coluna paginada só com cards, empate por `id`; card na coluna e vizinhos; contagem de subtarefas; posição sem versão;
  - rebalanceamento que segue a chave (ordem inversa à dos ids), encurta as chaves e não toca outro tenant;
  - contagem e reatribuição de todas as tarefas;
  - workflow: salvar com versão própria (sem mexer em `projects.version`), conflito, remoção em uso, nome sem diferenciar maiúsculas, isolamento.
- **Mutation testing**, 11/11 detectados. O sobrevivente da primeira rodada ("rebalancear pela ordem de id") dependia da sorte dos UUIDs: o teste foi reescrito com ordem inversa e o mutante morreu em duas rodadas seguidas.
- **Comandos**: `nx affected -t lint typecheck test` ✔; integração de `tasks` e `projects` ✔.

### T5 — 2026-10-14

- **Entregue** em `libs/backend/tasks/application`:
  - `shared/apply-transition.ts` — núcleo `applyTransition` extraído de `TransitionTask` (BR-004, BR-001, BR-006, D1; S1), `appendToColumn` (fim da coluna, sem o lock do projeto).
  - `TransitionTask` (detalhe) e `ReopenTask` põem o card no fim da coluna (D6); `CreateTask` já o fazia (T3).
  - `GetBoard`: colunas na ordem do workflow, cards por `(rank, id)`, `subtasks: { done, total }` sem canceladas, `actions.move`/`actions.configure` pelo papel efetivo e pelo arquivamento; consultas: uma por coluna + **uma** de nomes + **uma** de contagens.
  - `ListColumnCards`: status conferido no workflow do projeto resolvido; cursor `(statusId, rank, id)` validado e amarrado à coluna (`INVALID_CURSOR`, 400).
  - `MoveCard` (núcleo + casca), sempre com o lock do projeto em `tasks` (D3), na ordem de decisão do design. O par (anterior, sucessor) é resolvido sem o próprio card. Empate (B2) ou chave nova acima de 32 ⇒ rebalanceamento (limitado a 30 por projeto por hora; excedido ⇒ 429) e novo cálculo. A posição é validada **antes** das regras de transição. Eventos `tasks.card_moved` e, ao mudar de coluna, `tasks.status_changed`.
  - `CountTasksByStatus` e `ReassignTasksStatus` para a porta de `projects`.
  - Códigos `INVALID_CURSOR` (400), `INVALID_POSITION`/`TASK_NOT_A_CARD` (422) mapeados (paridade da 004 cobrou de novo).
- **Testes**: 11 novos (80 no projeto):
  - quadro (colunas, filtro de cards, contagens, consultas fixas, ações, 404), paginação e cursor;
  - reordenar (só o card movido, sem versão), mudar de coluna, recusas sem efeito (BR-004, BR-001 com ids), ordem de decisão completa;
  - empate rebalanceado; chave longa rebalanceada e o limite;
  - fim da coluna na criação, na transição pelo detalhe e na reabertura; contagem e reatribuição.
- **Mutation testing**, 13 mutantes: 12 detectados (um depois de reforçar o teste do fim da coluna). O sobrevivente é equivalente: `appendToColumn` sem excluir o próprio card (a chave nova fica depois do último card do mesmo jeito).
- **Comandos**: `nx affected -t lint typecheck test` ✔.

### T6 — 2026-10-14

- **Entregue** em `libs/backend/projects/application`:
  - porta `WorkflowStatusUsage` (`statusUsage`, `reassignStatus`), na linguagem de `projects`;
  - casos de uso `CreateStatus`, `UpdateStatus` (renomear e/ou categoria), `RemoveStatus` (com reatribuição), `ReorderStatuses` e `ReplaceTransitions`, sobre uma casca comum:
    - limite `projects.workflow.write.user.hour` (120);
    - transação com `lock_timeout` de 2 s (B8);
    - `lockProjectAndRereadActor` com `board:configure` (404 → 403);
    - `PROJECT_ARCHIVED`; versão do workflow (`VERSION_CONFLICT`);
    - workflow e uso relidos sob lock; edição pura do domínio (referências antes das regras);
    - reatribuição e gravação na mesma transação; evento `projects.workflow_changed` (com a contagem reatribuída) depois do commit;
  - `GetWorkflow` passa a devolver `version` e `inUse` por status (o antigo, sem versão, saiu de `get-project.use-case.ts`).
  - Fakes: `FakeWorkflowStatusUsage` transacional (desfeito com a transação), no testbed.
- **Antecipado da T7** (o gate exigiu): fundação de `tasks` com `CountTasksByStatus` e `ReassignTasksStatus`; adaptador `createWorkflowStatusUsage(tasksFoundation)` ligado em `createProjectsFoundation`, em `main.ts`, no harness de integração e nos dois testes de composição (ordem de montagem I2, sem ciclo).
- **Testes**: 8 novos (56 no projeto):
  - versão e "em uso"; criação sob lock com `lock_timeout` e evento;
  - ordem 404 → 403 → versão → regra → arquivado;
  - renomear e categoria com uso; remoção com e sem destino, referência estrangeira; reatribuição desfeita junto com a gravação que falhou;
  - reordenar e substituir transições com ids estrangeiros (404); limite.
- **Mutation testing**: 9/9 detectados. Um mutante foi refeito porque não compilava.
- **Comandos**: `nx affected -t lint typecheck test` ✔ (13 projetos); `pnpm test:integration` ✔ em 7 projetos (shared 33, identity 50, organizations 33, projects 24, worker 9, tasks 24, api 37).

### T7 — 2026-10-14

- **Entregue** em `apps/api`:
  - `createTasksModule` com `getBoard`, `listColumnCards` e `moveCard`;
  - `createProjectsModule` com `createStatus`, `updateStatus`, `removeStatus`, `reorderStatuses` e `replaceTransitions`;
  - ordem de montagem (I2): fundação de `tasks` → `createWorkflowStatusUsage` → fundação de `projects` (ligado na T6).
- **Testes**: `board-composition.integration.spec.ts`, 8 testes com a composição real e PostgreSQL; três execuções seguidas verdes:
  - BR-009: dois cards soltos no mesmo ponto ao mesmo tempo, ambos persistem em ordem determinística;
  - B2: empate forçado no banco ⇒ o movimento rebalanceia e entra entre os dois (chaves distintas depois);
  - rebalanceamento × criação concorrente: nenhum card perdido;
  - CA-07: remover a coluna destino durante um movimento ⇒ o movimento acontece antes (e a tarefa é reatribuída) ou recebe `STATUS_NOT_FOUND`, sem tarefa em status removido;
  - CA-07: substituir transições espera o movimento que segura o projeto, e o movimento seguinte vê as regras novas (`TRANSITION_NOT_ALLOWED`);
  - categoria do status inicial × criação: recusada se ganhou tarefa, senão a tarefa vai para o novo inicial;
  - remover status com tarefas reatribui **todas** (canceladas incluídas), intercaladas pela chave, com `version + 1`;
  - obrigação 5 da 004: excluir a organização remove projetos, workflow, tarefas e dependências.
- **Mutation testing**, 4/4 detectados na composição real: edição do workflow só com `FOR SHARE`; adaptador sem reatribuir; adaptador sem contar; empate sem rebalanceamento.
- **Regressão**: `pnpm test:integration` ✔ em 7 projetos (identity 50, shared 33, organizations 33, projects 24, tasks 24, worker 9, api 45). **Comandos**: `nx affected -t lint typecheck test` ✔.
