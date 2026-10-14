# 004 — Tarefas · Tarefas

Regras: uma tarefa por vez; marcar `[x]` somente com evidência executada (seção abaixo). Toda tarefa termina com `pnpm nx affected -t lint typecheck test` passando; tarefas com persistência, portas entre contextos ou harness também com `pnpm test:integration`. Mutation testing manual registrado por tarefa.

## Bloco A — Domínio e persistência

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                | Depende de | Verificação                                                                                                                                                                              | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T1  | Bibliotecas `libs/backend/tasks/{domain,application,infrastructure,http}` com tags. Domínio: `Task`, `TaskTitle`, `Priority`, `DueDate`, `TaskKey`, BR-001 (com D1), BR-004 (`assertTransitionAllowed`), BR-006 (grafo com aresta implícita D4 e tetos), BR-029, `taskActions` (D5), erros                            | —          | testes de domínio nomeados BR-001/004/006/028/029; lint de boundaries                                                                                                                    | [x]    |
| T2  | `prisma/models/tasks.prisma` + migration: `tasks`, `task_dependencies`, `task_counters`, `task_project_locks`, enum, CHECKs, FKs compostas e entre contextos, `SET NULL (assignee_user_id)` manual; back-relations inertes; lints `tasksMustNotReachOtherContexts`, extensão em `organizations` e bloco em `projects` | T1         | `prisma validate` (aviso esperado); **teste de catálogo** do `SET NULL (coluna)`; integração: CHECKs, FKs do mesmo projeto, cascata, RESTRICT do status, `SET NULL` ao apagar membership | [x]    |
| T3  | Repositórios Prisma de `tasks` (sempre com `organizationId` e `projectId`; uma linha por escrita; contador por `upsert`; lock do projeto; keyset; carga do grafo por níveis; `P2002`/`P2003` traduzidos)                                                                                                              | T2         | integração dos repositórios, numeração simultânea sem repetição, versão                                                                                                                  | [x]    |
| T4  | `shared/infrastructure`: runner com READ COMMITTED explícito e uma nova tentativa em `P2034` (depois 409 `CONCURRENT_UPDATE`)                                                                                                                                                                                         | —          | integração: deadlock provocado é repetido e vence; segundo deadlock ⇒ 409                                                                                                                | [x]    |

## Bloco B — Portas entre contextos e aplicação

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                                                                                                                                         | Depende de | Verificação                                                                                                                                     | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T5  | `organizations`: `LockMembersForShare`, página de owners/admins. `projects`: `LockProjectForContribution` (projeto `FOR SHARE`, memberships `FOR SHARE`, workflow no retorno), `ResolveProjectForRead` (id ou chave, consulta única), `ListAssignableUsers`; porta `ProjectContributorChanges` chamada por `RemoveProjectMember`, `ChangeProjectMemberRole` (com `alsoRead`) e `ApplyOrganizationRoleChange` (toda mudança para member/viewer) | T3         | fakes e integração: locks segurados até o commit; porta chamada só quando o papel efetivo deixa de ser manager/member; testes da 002/003 verdes | [x]    |
| T6  | `tasks/application`: portas; `RevokeAssignmentsOnAccessLoss`; `CreateTask`, `ListTasks`, `GetTask` (id/chave, 404 uniforme), `UpdateTask`, `AssignTask`, `ListAssignableUsers` (núcleo + casca, eventos após o commit)                                                                                                                                                                                                                         | T1, T5     | fakes: CA-01, CA-02, CA-05 (regras), CA-07; ordem de decisão                                                                                    | [x]    |
| T7  | `TransitionTask`, `CancelTask`, `ReopenTask`, `DeleteTask`, `AddDependency`, `RemoveDependency`                                                                                                                                                                                                                                                                                                                                                | T6         | fakes: CA-03, CA-04, CA-06, CA-08, D1, D2, D4, D5                                                                                               | [x]    |
| T8  | Composição em `apps/api` (ordem de montagem, adaptadores, `ApiModules.tasks`); integração concorrente: numeração, A↔B, pai × subtarefa obrigatória, atribuição × rebaixamento, arquivar × criar, reação × transição (sem deadlock não recuperado); caminhos de RF-11 um a um; reações sem afetar outra organização; verificador do invariante BR-003                                                                                           | T4, T7     | integração: CA-05, CA-08, RNF-02                                                                                                                | [x]    |

## Bloco C — HTTP, isolamento e autorização

| ID  | Tarefa                                                                                                                                                                                                                                    | Depende de | Verificação                                            | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------ | ------ |
| T9  | `libs/contracts/tasks` (`strictObject`), router (rotas literais antes de `/:taskId`), erros, limites, OpenAPI                                                                                                                             | T8         | Supertest: contratos, 400/403/404/409/422/429; OpenAPI | [x]    |
| T10 | Harness: casos das rotas novas com schemas (referências de corpo e query, `assigned` separado); bateria intra-tenant de `/tasks` (cobertura de rotas, 404 idêntico, 403 antes de estados, IDOR entre projetos por caminho, corpo e query) | T9         | integração (CA-09); lacunas fazem falhar               | [x]    |

## Bloco D — Frontend e jornada

| ID  | Tarefa                                                                                                                                                                                                 | Depende de | Verificação                     | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------- | ------ |
| T11 | `features/tasks`: data-access, guards; aba "Tarefas" (lista com filtros, estados, paginação) e "Nova tarefa"                                                                                           | T9         | testes de componente            | [ ]    |
| T12 | Detalhe `/o/:slug/projects/:key/tasks/:number`: edição, status pelas transições da API, responsável entre elegíveis, subtarefas, dependências, cancelar/reabrir, excluir; mensagens dos 422 com os ids | T11        | testes de componente (CA-10)    | [ ]    |
| T13 | E2E real: criar tarefa, atribuir, subtarefa obrigatória, conclusão do pai recusada, concluir subtarefa e pai                                                                                           | T12        | Playwright no banco descartável | [ ]    |

## Bloco E — Documentação e validação

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                                         | Depende de | Verificação                                                           | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- | ------ |
| T14 | `bounded-contexts.md` (tasks implementado, seta `TSK → ORG`, exceções, invariante de locks), `dependency-rules.md`, `business-rules.md` (BR-001/003/006 atualizadas, BR-028, BR-029), `authorization.md`, `multi-tenancy.md`, `testing.md`; design da 003 (revisão registrando a substituição das obrigações 2 e 3); índice de specs e roadmap | T1–T13     | verificação de links                                                  | [ ]    |
| T15 | `/review-code` e `/security-audit`; correções; gate final                                                                                                                                                                                                                                                                                      | T14        | sem bloqueantes / sem Críticos-Altos; `pnpm verify`, integração e E2E | [ ]    |

## Evidências

### T1 — 2026-10-14

- **Entregue**:
  - bibliotecas `libs/backend/tasks/{domain,application,infrastructure,http}` (tags `domain:tasks`) e aliases;
  - domínio:
    - `TaskTitle`, `parseTaskDescription`, prioridades, `parseDueDate` (data de calendário), `parseTaskKey`/`formatTaskKey` (BR-028);
    - `Task` (BR-029 cancelar/reabrir idempotentes; conclusão pela categoria `done`; "obrigatória" só em subtarefa);
    - workflow (`initialStatus`, `transitionTargets`, `assertTransitionAllowed` — BR-004);
    - `assertNoCycle`: BFS por níveis com tetos de 64 níveis e 500 nós e a aresta implícita vinda do expansor (D4);
    - `taskActions` (D5: exclusão com `ownsTaskTree`);
    - erros com `code` estável (BR-001 e BR-006 carregam os ids);
    - contratos de repositório.
- **Testes** (26): campos, BR-028, BR-029, conclusão, BR-004, ciclos diretos, indiretos e implícitos (D4), tetos, uma consulta por nível, ações por papel, D5, cancelada e arquivado.
- **Mutation testing**, 7/7 detectados: cancelada editável; conclusão fora da categoria `done`; transição livre; ciclo não verificado; sem teto de profundidade; exclusão ignorando a árvore; obrigatória sem pai.
- **Comandos**: `nx run-many -t lint typecheck test -p backend-tasks-domain` ✔; `nx affected -t lint typecheck test` ✔.

### T2 — 2026-10-14

- **Entregue**:
  - `prisma/models/tasks.prisma`:
    - modelos `Task`, `TaskDependency`, `TaskCounter` e `TaskProjectLock` e o enum `task_priority`;
    - FKs compostas internas (pai, dependências e status do mesmo projeto) e as FKs entre contextos do ADR 0015: projeto CASCADE, status RESTRICT e responsável → `memberships`;
    - back-relations inertes: `Project.tasks`, `taskCounter` e `taskProjectLock`; `WorkflowStatus.tasks`; `Membership.assignedTasks`.
  - Migration `20261014033610_add_tasks`, gerada no banco descartável. O `SET NULL ("assignee_user_id")` foi **editado à mão** e comentado. Os CHECKs garantem número ≥ 1, título normalizado, descrição não vazia, obrigatória só em subtarefa, pares de conclusão e cancelamento coerentes e dependência entre tarefas distintas. Aplicada só ao `taskflow_e2e`.
  - Lints `tasksMustNotReachOtherContexts` e `projectsMustNotReachTasks`; `organizationsMustNotReachProjects` passou a cobrir `assignedTasks` e os modelos de `tasks`. As três regras ignoram `*.integration.spec.ts`, que semeia tabelas de outros contextos de propósito.
- **Verificação**:
  - `prisma validate` ✔, com o aviso esperado do `SetNull`;
  - `migrate diff` contra o banco migrado diz "No difference detected", **mesmo com a lista de colunas**. Isso confirma que o drift seria invisível e que o teste de catálogo é a proteção real;
  - integração (`backend-tasks-infrastructure`, 8 testes):
    - **catálogo** (`confdeltype = n`, `confdelsetcols = [assignee_user_id]`);
    - apagar a membership desatribui e mantém `organization_id`; responsável fora da organização recusado;
    - número único por projeto;
    - pai, status e dependência só do mesmo projeto;
    - CHECKs; status em uso não pode ser apagado;
    - cascatas da tarefa e da organização;
  - amostras de lint via `eslint --stdin`: 2 violações em `tasks`, 1 em `projects`;
  - integração de `projects` (17), `organizations` (32) e API (18) continua verde.
- **Mutation testing**, 3/3 detectados: `SET NULL` sem lista de colunas (o drift temido: o catálogo e a remoção falham); status em CASCADE; CHECK de "obrigatória" removido.
- **Comandos**: `nx run-many -t lint` ✔ (25 projetos); `nx affected -t lint typecheck test` ✔.

### T3 — 2026-10-14

- **Entregue** (`libs/backend/tasks/infrastructure`):
  - `PrismaTaskRepository`:
    - `nextNumber` por `upsert` nativo;
    - `lockProject`: `upsert` nativo da linha de `task_project_locks`, que fica travada até o commit; sem SQL raw;
    - `lockById` com `FOR NO KEY UPDATE`;
    - `save` e `remove` com versão;
    - `listPage` em keyset por número decrescente (cursor só com o número), com filtros de status, responsável, sem responsável, prioridade, canceladas e pai;
    - `subtasksOf`, `findByIds`, `requiredSubtaskIds` (aresta implícita D4);
    - `revokeAssignments` por escopo, sempre com `organizationId`, incrementando a versão; só em transação;
    - `P2003` ⇒ `TaskNotFoundError`.
  - `PrismaTaskDependencyRepository`: adição idempotente checada **antes** de inserir (um `P2002` abortaria a transação), remoção, os dois sentidos, contagens, `P2003` ⇒ 404.
  - Domínio: `TaskNotFoundError` (`TASK_NOT_FOUND`).
- **Achados no caminho**:
  - `upsert` com `update: {}` não usa o `ON CONFLICT` nativo do Prisma: vira "procura e cria" e corre (`P2002` na criação concorrente da linha de lock). Corrigido com uma atualização sem efeito.
  - O mutante "lock sem `FOR UPDATE`" **sobreviveu** porque o `upsert` já trava a linha. O `SELECT … FOR UPDATE` era redundante e foi removido. O mutante que troca o `upsert` por leitura simples morre.
- **Testes** (integração, 14): 20 numerações simultâneas sem repetição; lock serializa e exige transação; busca, gravação e remoção com organização, projeto e versão; lista com filtros, keyset e cursor inválido; subtarefas e obrigatórias; revogação por projeto e por organização com exceção, sem tocar outra organização; dependências idempotentes, contagens e 404 de tarefa apagada.
- **Mutation testing**, 5/5 detectados: revogação sem `organizationId`; canceladas listadas; `save` sem versão; cursor ignorado; lock por leitura simples.
- **Comandos**: `nx run backend-tasks-infrastructure:integration-test --skip-nx-cache` ✔ 14/14; `nx affected -t lint typecheck test` ✔.

### T4 — 2026-10-14

- **Sonda antes de codificar**: um deadlock real provocado em teste chega ao Prisma 7 como `P2034`, com `meta.driverAdapterError.cause.originalCode = 40P01`. A sonda foi removida.
- **Entregue**:
  - `PrismaTransactionRunner.run`:
    - fixa **READ COMMITTED**;
    - repete **uma vez** a transação mais externa quando `isTransactionConflict` (`P2034`, ou SQLSTATE `40P01`/`40001` vindo de SQL raw);
    - persistindo o conflito, lança `ConcurrentUpdateError`; outros erros não são repetidos;
    - transações aninhadas não repetem por conta própria;
    - JSDoc registra que `work` precisa ser reexecutável (sem efeitos externos, ADR 0008).
  - `ConcurrentUpdateError` em `shared/application`, mapeado para **409 `CONCURRENT_UPDATE`** no error handler de `shared/http`.
- **Testes**:
  - integração (4 novos, 32 no projeto):
    - READ COMMITTED **mesmo com o padrão do banco mudado para SERIALIZABLE** (sem isso, o mutante "herdar o nível" seria equivalente);
    - deadlock real repetido, com as duas transações concluídas (3 tentativas);
    - conflito persistente vira `ConcurrentUpdateError` depois de 2 tentativas;
    - erro comum não é repetido; o aninhado não repete;
  - HTTP: 409 `CONCURRENT_UPDATE`.
- **Mutation testing**, 2/2 detectados: sem repetição; isolamento herdado.
- **Regressão**: `pnpm test:integration --skip-nx-cache` ✔ em 7 projetos (shared 32, identity 50, organizations 32, projects 17, worker 9, api 18, tasks 14). O runner é de todos os contextos.
- **Comandos**: `nx affected -t lint typecheck test` ✔ (25 projetos).

### T5 — 2026-10-14

- **Entregue**:
  - `organizations`:
    - `MembershipRepository.lockRolesForShare`: SQL raw só para o `FOR SHARE`; os papéis vêm por `rolesOf` na mesma transação;
    - caso de uso `LockMembersForShare`, exposto pela porta `OrganizationAccess.lockMembersForShare` de `projects`;
    - a página de owners/admins reaproveita `listMembersPage` com filtro de papéis (já existia).
  - `projects`:
    - `ProjectRepository.lockForShare` por id ou chave;
    - `ProjectMemberRepository.rolesOf`, `listForUser` e `listPage(…, roles)`;
    - casos de uso `LockProjectForContribution`, `ResolveProjectForRead` e `ListAssignableUsers` (cursor `p:`/`o:`; owner/admin só na fase da organização);
    - porta `ProjectContributorChanges`, chamada por:
      - `RemoveProjectMember`, quando o papel efetivo sem a participação não contribui;
      - `ChangeProjectMemberRole`, quando o papel novo não contribui;
      - `ApplyOrganizationRoleChange`, em toda mudança para member/viewer, depois do teto, com `stillContributorIn`.
  - `tasks/application` (antecipado da T6, porque a composição precisa dele): `RevokeAssignmentsOnAccessLoss` e os fakes `InMemoryTaskRepository`/`InMemoryTaskDependencyRepository`.
  - `apps/api`: ordem de montagem `createTasksFoundation` → `createProjectsFoundation({ contributorChanges })` → organizations → módulos, em `main.ts`, no harness de integração e em `projects-composition.integration.spec.ts`.
- **Testes**:
  - aplicação de `projects`, 9 novos (48 no projeto):
    - gatilhos da porta: remoção; troca para viewer (não para manager); admin com participação antiga viewer rebaixado a member perde só aquele projeto; admin saindo da participação antiga não gera aviso; promoções não geram aviso;
    - casos de uso de contribuição: locks pedidos e papéis efetivos (incluindo pessoa de fora → `null`); outra organização → `null`; fora de transação falha; leitura por id/chave; candidatos a responsável em duas fases, sem duplicar admin participante;
  - `tasks/application`: 4 testes de `RevokeAssignmentsOnAccessLoss`;
  - integração:
    - `organizations` (1 novo, 33 no projeto): o `FOR SHARE` das memberships segura a troca de papel até o commit, não bloqueia outro membro e falha fora de transação;
    - `projects` (4 novos, 21 no projeto): o `FOR SHARE` do projeto segura o arquivamento e convive com outro `FOR SHARE`; busca por chave restrita à organização (com a mesma chave nas duas); leituras de participações.
- **Mutation testing**, 8/10 detectados. Os 2 sobreviventes são equivalentes:
  - "avaliar o papel da participação sem o papel da organização" em `ApplyOrganizationRoleChange`: o teto para viewer roda antes, e para member o papel efetivo é o da participação;
  - "`seesAll` para todos" em `ResolveProjectForRead`: `effectiveProjectRole(member, null)` devolve `null`, e o caso de uso responde `null` (defesa dupla).
  - Dois sobreviventes da primeira rodada viraram testes: owner/admin duplicado nos candidatos; chave sem filtro de organização no lock.
- **Regressão**: `pnpm test:integration` ✔ em 7 projetos (shared 32, identity 50, organizations 33, projects 21, tasks 14, worker 9, api 18).
- **Comandos**: `nx affected -t lint typecheck test` ✔ (25 projetos).

### T6 — 2026-10-14

- **Entregue** em `libs/backend/tasks/application`:
  - portas `ProjectAccess` (`lockForContribution`, `resolveForRead`, `assignableUsers`) e `TaskUserDirectory` (nomes em lote);
  - erros de aplicação com os mesmos códigos de `organizations`/`projects`: `ORGANIZATION_NOT_FOUND`, `INSUFFICIENT_ROLE`, `PROJECT_NOT_FOUND`, `PROJECT_ARCHIVED`; e os novos `ASSIGNEE_NOT_PROJECT_MEMBER`, `STATUS_NOT_FOUND`, `TASK_LIMIT_REACHED`, `SUBTASK_LIMIT_REACHED`;
  - limites da D3 e políticas `tasks.create.user.hour` (300) e `tasks.write.user.hour` (1200); eventos `tasks.*` (só ids);
  - `lockTaskForWrite`, o caminho comum das rotas por tarefa:
    - 404 uniforme `TASK_NOT_FOUND`; ator removido ⇒ `ORGANIZATION_NOT_FOUND`;
    - 403 antes de `PROJECT_ARCHIVED`;
    - locks na ordem do design;
  - `findTaskForRead` por id ou `CHAVE-N`; `loadTaskView`, que monta o detalhe em consultas fixas, com ações, D5, subtarefas, bloqueadoras e bloqueadas (até 50, com `blockingTruncated`);
  - casos de uso com núcleo `…WithinTransaction` (devolve os eventos) e casca `runTaskWrite`: limite, transação, detalhe na transação e eventos **depois do commit**:
    - `CreateTask` (BR-028, um nível, D1, BR-003, limites; subtarefa sob o lock do projeto em `tasks`);
    - `UpdateTask` (BR-029 antes de BR-008; marca "obrigatória" sob o lock do projeto, com D1 e D4);
    - `AssignTask` (alvo relido com a membership `FOR SHARE`; mesmo responsável não grava nem registra evento);
  - consultas `ListTasks` (filtros; `assigned=me` com outro `assigneeUserId` ⇒ lista vazia), `GetTask` e `ListAssignableUsers` (403 para quem não atribui).
  - Fakes: `FakeProjectAccess`, `InMemoryTaskUserDirectory`, `RecordingTasksEvents` e o cenário `createTasksWorld`.
- **Ajuste em `projects`**: `ProjectContribution.organizationMembers` (quem ainda é membro), para distinguir ator removido de sem acesso.
- **Decisões de implementação** (dentro do design):
  - a regra de fronteira do lint (`.project`) vale também na aplicação, por isso o resultado do núcleo usa `projectContext`;
  - criar subtarefa de pai **cancelado** é permitido (a spec não proíbe; cancelada não aceita edição, e criar filha não edita o pai);
  - tornar obrigatória uma subtarefa já concluída sob pai concluído é aceito, porque a invariante da D1 é "pai concluído sem obrigatória pendente".
- **Testes**: 44 novos (48 no projeto), cobrindo:
  - CA-01: numeração, nunca reutilizada, 403 do viewer;
  - CA-02: regras de subtarefa, D1 e teto de 100;
  - CA-05: aceitos e recusados, incluindo de outra organização;
  - CA-07: 30 tarefas, páginas de 25, filtros, uma consulta de nomes por página;
  - detalhe por id e por chave, 404 uniforme (M3), D4 direto, indireto e pela aresta implícita;
  - ordem de decisão 404 → 403 → 409 arquivado → 409 cancelada → 409 versão;
  - limites, inclusive na fronteira; núcleo na transação do chamador.
- **Mutation testing**, 23 mutantes, 22 detectados. O sobrevivente é equivalente: "busca por chave sem checar o projeto" (sem projeto, a tarefa nem é buscada). Três lacunas da primeira rodada viraram testes: fronteira do teto de 10 000, `blockingTruncated` com exatamente 50, ciclo pela aresta implícita.
- **Comandos**: `nx affected -t lint typecheck test` ✔ (25 projetos).
- **Pendente para a T8**: o adaptador de `ProjectAccess` e `TaskUserDirectory` em `apps/api`; a integração com Prisma do detalhe (consultas concorrentes na mesma transação).

### T7 — 2026-10-14

- **Entregue**:
  - `TransitionTask`:
    - BR-004 (`TRANSITION_NOT_ALLOWED`, inclusive para o mesmo status); status de outro projeto ⇒ `STATUS_NOT_FOUND`, depois da versão;
    - ao entrar em `done`: BR-001 (`TASK_HAS_PENDING_REQUIRED_SUBTASKS` com ids) e BR-006 (`TASK_BLOCKED_BY_DEPENDENCIES` com ids); ao sair de `done`, D1 para subtarefa obrigatória de pai concluído;
    - o lock do projeto em `tasks` só é tomado ao entrar ou sair de `done`, decidido pela leitura anterior ao lock. Se a tarefa mudar para/de `done` entre a leitura e o lock, responde `CONCURRENT_UPDATE` (409; o cliente repete).
  - `CancelTask` e `ReopenTask`: idempotentes, sob o lock do projeto. Ao reabrir:
    - pai em `done` com obrigatória pendente ⇒ `TASK_HAS_PENDING_REQUIRED_SUBTASKS`;
    - obrigatória que volta a ficar pendente com pai concluído ⇒ `PARENT_TASK_COMPLETED`.
  - `DeleteTask`: D5 decidido sob o lock do projeto (subtarefas lidas ali); cancelada pode ser excluída; cascata.
  - `AddDependency`: mesmo projeto (senão `TASK_NOT_FOUND`); duplicada idempotente, verificada **antes** dos tetos; tetos de 50 bloqueadoras e 5 000 por projeto; ciclo com a aresta implícita (D4); D2. `RemoveDependency`: ausente ⇒ `DEPENDENCY_NOT_FOUND` (404, código novo). As duas recusam tarefa cancelada (`TASK_CANCELED`).
  - A casca foi generalizada: `runTaskMutation` (limite, transação, eventos depois do commit), com `runTaskWrite` sobre ela.
- **Testes**: 20 novos (68 no projeto), cobrindo CA-02 (conclusão do pai), CA-03, CA-04, CA-06, CA-08 (as 9 escritas: 403 antes de 409, e leitura segue), D1 (sair de `done` e reabrir), D2, D4 (direto e indireto) e D5.
- **Mutation testing**: 21/21 detectados.
- **Comandos**: `nx affected -t lint typecheck test` ✔ (25 projetos).

### T8 — 2026-10-14

- **Entregue** em `apps/api`:
  - `createProjectAccess`: porta `ProjectAccess` sobre os casos de uso de contribuição de `projects`, que o módulo de `projects` passa a expor em `contribution`. O workflow é copiado explicitamente para `WorkflowView`.
  - `createTaskUserDirectory`: nomes vindos de `identity`.
  - `createTasksModule`: casos de uso sobre a fundação; eventos `tasks.*` no log (`info`), só com ids.
  - A ordem de montagem do design foi reproduzida no teste.
- **Movido para a T9 (registrado)**: a ligação de `createTasksModule` em `main.ts` e o campo `ApiModules.tasks`. Sem o router, o módulo ficaria sem uso em `main.ts`, e o campo exige o `tenantRouter`.
- **Testes**: `tasks-composition.integration.spec.ts`, 14 testes com a composição real e PostgreSQL. O **verificador do invariante BR-003** roda depois de cada teste (todo responsável com papel efetivo manager/member).
  - RNF-02:
    - 20 criações simultâneas com números 1–20 e, depois de excluir WEB-2, a próxima é WEB-21;
    - A↔B em paralelo ⇒ exatamente um `DEPENDENCY_CYCLE`;
    - concluir o pai × criar obrigatória (5 rodadas) ⇒ exatamente uma falha (`PARENT_TASK_COMPLETED` ou `TASK_HAS_PENDING_REQUIRED_SUBTASKS`) e nenhum pai concluído com pendência;
    - atribuir × rebaixar a viewer ⇒ nenhum leitor responsável;
    - arquivar espera a criação que segura o lock e depois recusa (`PROJECT_ARCHIVED`);
    - revogação × transição (5 rodadas), sem deadlock não recuperado.
  - CA-05, caminhos de RF-11:
    - remoção e saída do projeto;
    - participação para viewer (para manager, não);
    - papel na organização para viewer;
    - admin com participação antiga viewer rebaixado a member (perde só aquele projeto);
    - admin saindo da participação antiga (mantém);
    - viewer → admin → member;
    - remoção e saída da organização (sucesso; `SET NULL` do banco);
    - outra organização intacta.
  - O cenário respeita a D1 da 003: participações antigas de admin são gravadas quando a pessoa ainda era member.
  - Três execuções seguidas, todas verdes.
- **Mutation testing**, 6/6 detectados na composição real:
  - lock do projeto em `tasks` sem efeito;
  - memberships sem `FOR SHARE` no lock de contribuição;
  - projeto sem `FOR SHARE`;
  - adaptador de `ProjectContributorChanges` sem efeito;
  - revogação ignorando `stillContributorIn`;
  - workflow sem transições no adaptador.
- **Regressão**: `pnpm test:integration --skip-nx-cache` ✔ em 7 projetos (shared 32, identity 50, organizations 33, tasks 14, projects 21, worker 9, api 32).
- **Comandos**: `nx affected -t lint typecheck test` ✔ (25 projetos).

### T9 — 2026-10-14

- **Entregue**:
  - `libs/contracts/src/lib/tasks/tasks.contract.ts`:
    - comandos `strictObject`, sem `organizationId`, `number`, `statusId` na criação, `completedAt` e `createdByUserId`;
    - edição com ao menos um campo;
    - lista com `assigneeUserId` só UUID e `assigned=me|none` separado (M6.1); `canceled=true|false`;
    - `TASK_KEY_PATTERN` (BR-028); schemas de resposta (`Task`, `TaskSummary`, `TaskActions`, páginas, candidatos).
  - **Mudança de contrato compartilhado**: `ProblemDetails.taskIds` (membro de extensão da RFC 9457), preenchido pelo mapeamento `DomainErrorMapping.taskIds` em `shared/http`. Usado por `TASK_HAS_PENDING_REQUIRED_SUBTASKS` e `TASK_BLOCKED_BY_DEPENDENCIES` (BR-001/BR-006 "com os ids"). **A registrar no design na T14.**
  - `libs/backend/tasks/http`:
    - `createTasksRouter` com as 13 rotas, sendo as literais (`assignable-users`, `by-key`) antes de `/:taskId`;
    - parâmetro malformado ⇒ 404 `TASK_NOT_FOUND` sem chegar ao caso de uso;
    - dependência duplicada ⇒ 200; `no-store`.
  - `tasksErrorMappings`, com os códigos compartilhados idênticos aos de `projects` (teste de colisão em `apps/api` ampliado).
  - `tasksOpenApiPaths`/`tasksOpenApiSchemas` no documento da API.
  - Os limites de uso ficam nos casos de uso (contam também as tentativas recusadas); o router não duplica.
- **Movido para a T10 (registrado)**: a montagem do router em `ApiModules`/`main.ts`/harness. Montá-lo exige os casos de isolamento das rotas novas (o teste de cobertura falha fechado), que são o escopo da T10.
- **Testes**:
  - router (Supertest, fakes), 10 testes: 201 com `Location`; leitura por id e por chave; lista; 400 (campos desconhecidos, consulta, domínio); 403; 404 uniforme (oculta × inexistente com o mesmo título) e malformado; 409 (versão, cancelada, arquivado); 422 com `taskIds`; dependências 201/200/204/404; atribuição; exclusão; 429 com `Retry-After`; CSRF;
  - paridade de catálogos: prioridades, formato da chave e **todo código de erro de `tasks` com mapeamento HTTP explícito**;
  - contratos: 4; `shared/http`: extensão `taskIds`; `apps/api`: OpenAPI 3.1 válido com as 13 operações e colisão de códigos com `tasks`.
- **Mutation testing**, 9/9 detectados. O sobrevivente da primeira rodada ("id malformado passa ao caso de uso", equivalente no fake, mas 500 no Prisma) virou teste: nenhum ponto de limite é consumido.
- **Comandos**: `nx affected -t lint typecheck test` ✔.

### T10 — 2026-10-14

- **Montagem** (o que veio da T8 e da T9):
  - `createTasksModule` expõe `tenantRouter` e `domainErrors`;
  - `ApiModules.tasks` passa a ser **obrigatório** em `api-routers.ts`;
  - `main.ts` monta `createTasksModule` (passo 5 da ordem de montagem) e junta os erros;
  - o harness de integração (`integration-api.ts`) usa a mesma composição e ganha `put` no cliente;
  - o teste de cobertura de rotas monta o router real sobre fakes.
- **Harness de isolamento** (spec 006 ampliado):
  - casos para as 13 rotas, cobrindo caminho (`taskId`, `key`, `blockingTaskId`), corpo (`projectId`, `parentTaskId`, `assigneeUserId`, `statusId`, `blockingTaskId`) e query (`projectId`, `statusId`, `assigneeUserId`, `parentTaskId`, `cursor`), com `assigned` fora das referências (M6.1);
  - expectativa nova `refused` (422 com código): responsável de B ⇒ `ASSIGNEE_NOT_PROJECT_MEMBER`, sem 404;
  - o mundo semeado ganha tarefa de A e, em B, duas tarefas com responsável, dependência, status e cursores de tarefas e de candidatos;
  - o filtro de status usa o status **inicial** de B, onde estão as tarefas de B: um filtro sem tenant as vazaria.
- **Bateria intra-tenant** (`tasks-authorization.integration.spec.ts`, 5 testes):
  - "covers every task route";
  - CA-09: oculta × inexistente com corpo idêntico em todas as rotas (`TASK_NOT_FOUND` por tarefa; `PROJECT_NOT_FOUND` por `projectId`);
  - viewer participante com 403 em toda escrita antes de erros de estado, e leituras 200;
  - D5 com 403 antes da versão;
  - IDOR entre projetos (pai, bloqueadora, status, responsável e filtros `parentTaskId`/`statusId` de P2 em P1) recusado **também para o owner**, sem ids de P2 nas respostas e com P2 intacto.
- **Mutation testing**, 6 mutantes, 5 detectados: router não montado; lista sem filtro de projeto; lista sem filtro de tenant; leitura por id sem checar acesso ao projeto; "sem acesso" como 403. O sobrevivente "`findByIds` sem filtro de projeto" é barrado pelas **FKs compostas** do banco (pai e dependências do mesmo projeto, RNF-03): `P2003` ⇒ `TASK_NOT_FOUND`. É equivalente na HTTP e prova a defesa em profundidade.
- **Regressão**: `pnpm test:integration --skip-nx-cache` ✔ em 7 projetos (identity 50, shared 32, organizations 33, projects 21, tasks 14, worker 9, api 37).
- **Comandos**: `nx affected -t lint typecheck test` ✔ (25 projetos).
