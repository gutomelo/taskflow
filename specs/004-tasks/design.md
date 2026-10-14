# 004 — Tarefas · Design técnico

- **Status**: Rascunho (revisão 2)
- **Requisitos**: [requirements.md](requirements.md)
- **Revisão de arquitetura**: feita (revisão 2 incorpora os achados)
- **Revisão de segurança**: feita (revisão 2 incorpora os achados)

## Solução proposta

Novo bounded context **`tasks`** em `libs/backend/tasks/{domain,application,infrastructure,http}` (tags `scope:backend`, `domain:tasks`), no desenho de `projects`: invariantes no domínio, decisões no caso de uso com o estado relido sob lock, repositórios que sempre recebem `organizationId` e `projectId`, router tenant-scoped em `createTenantScope`.

**Autorização**: `canOnProject(papelEfetivo, 'task:*', { ownsResource })` do kernel (spec 006). `ownsResource` para `task:delete` do member = criou a tarefa **e** todas as subtarefas dela (achado M4: a cascata não apaga trabalho alheio). O papel efetivo vem de `projects` pela porta `ProjectAccess`; `tasks` nunca lê tabelas de outro contexto (lint, abaixo).

**Uma regra, uma fonte** (achado bloqueante da arquitetura / A1 da segurança): "quem deixou de poder contribuir" (papel efetivo deixou de ser `manager`/`member`) é decidido **só em `projects`**, com `effectiveProjectRole` do kernel. `tasks` só executa a desatribuição. A cadeia é linear: `organizations → projects → tasks`.

### Portas (ligadas em `apps/api/src/modules/adapters`)

- `tasks` → `projects`: **`ProjectAccess`** em `tasks/application`:
  - `lockForContribution(organizationId, lookup, userIds)` — trava o projeto `FOR SHARE` (BR-026 contra arquivamento concorrente) e as memberships dos usuários pedidos `FOR SHARE` (contra mudança de papel e remoção na organização); lê as participações sem lock (ver invariante em Concorrência); devolve `{ projectId, key, archived, workflow, effectiveRoles: Map<userId, ProjectRole | null> } | null`. O **workflow vem lido depois do lock**, no mesmo retorno (obrigação para a 005). Implementada por `LockProjectForContribution` em `projects`, que usa a porta nova `lockMembersForShare` de `organizations`. A linha da organização **não** é travada (obrigação 2 da 003).
  - `resolveForRead(organizationId, lookup: { projectId } | { key }, viewer)` → `{ projectId, key, archived, workflow, effectiveRole } | null`, numa consulta com o filtro de visibilidade (como `findReadableProject`), sem lock.
  - `assignableUsers(organizationId, projectId, page)` → quem tem papel efetivo `manager`/`member`, por cursor (participantes não viewer, depois owners/admins), como `member-candidates`.
- `projects` → `tasks`: **`ProjectContributorChanges`** em `projects/application`, na linguagem de `projects`, retorno `void`:
  - `contributorAccessReduced({ organizationId, userId, scope: { projectId } | 'organization', stillContributorIn: projectId[] })`.
  - Chamada por `RemoveProjectMember` e `ChangeProjectMemberRole` (que passam a reler o papel do alvo na organização com `alsoRead`), quando `effectiveProjectRole(papelNaOrg, novaParticipação)` deixa de ser `manager`/`member`; e por `ApplyOrganizationRoleChange` para **toda** mudança de papel na organização para `member` ou `viewer` (escopo `organization`, `stillContributorIn` = projetos em que a participação, depois do teto, ainda é `manager`/`member`).
- `organizations` → `projects`: `MembershipRoleChanges` (spec 003) **continua com um ouvinte só**.
- Remover/sair da organização: FK `(organization_id, assignee_user_id) → memberships ON DELETE SET NULL (assignee_user_id)` (decisão 7; substitui a obrigação 3 da 003). Sem evento próprio de `tasks` nem incremento de `version` (exceção a BR-008 registrada; o evento `organizations.member_removed` é a evidência — ADR 0015, item 4).

### Ordem de montagem em `apps/api`

1. `createTasksFoundation` (repositórios e `RevokeAssignmentsOnAccessLoss`, só sobre repositórios de `tasks`);
2. `createProjectsFoundation({ contributorChanges: adapter(tasksFoundation) })`;
3. `createOrganizationsModule({ membershipRoleChanges: adapter(projectsFoundation) })`;
4. `createProjectsModule({ organizationAccess, contributorChanges })`;
5. `createTasksModule({ projectAccess: adapter(projectsModule), users })`;
6. `ApiModules.tasks` obrigatório em `api-routers.ts`.

Contrato transacional (invariantes testadas): instância única do runner; `RevokeAssignmentsOnAccessLoss`, `lockForContribution` e os locks de `tasks` usam `transactionalClient`; o runner fixa **READ COMMITTED** (o protocolo depende de quem chega depois reler o que foi gravado — achado B5).

### Regras de workflow e eventos

- BR-004 vive em `tasks/domain` (`assertTransitionAllowed(workflow, from, to)`); a 005 reutiliza.
- **Núcleo e casca** (achado I5.1): cada caso de uso de escrita tem um núcleo `…WithinTransaction` que devolve os eventos, e a casca HTTP abre a transação e registra os eventos **depois do commit**. A 005 chama o núcleo dentro da própria transação e registra depois do próprio commit.

## Componentes envolvidos

| Projeto Nx                                 | Camada         | Mudança                                                                                                                                                                                             |
| ------------------------------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/tasks/domain` (novo)         | domain         | `Task`, `TaskTitle`, `Priority`, `DueDate`, `TaskKey`, BR-001/004/006/029, `taskActions`, grafo com aresta implícita (D4) e tetos, erros                                                            |
| `libs/backend/tasks/application` (novo)    | application    | Portas `ProjectAccess`, `UserDirectory`; casos de uso (núcleo + casca); `RevokeAssignmentsOnAccessLoss`; limites; eventos `tasks.*`; fakes                                                          |
| `libs/backend/tasks/infrastructure` (novo) | infrastructure | Repositórios Prisma; contador; lock do projeto em `tasks`; keyset `(number desc)`; `P2003` ⇒ `TASK_NOT_FOUND`                                                                                       |
| `libs/backend/tasks/http` (novo)           | presentation   | `createTasksRouter`, erros, limites, OpenAPI                                                                                                                                                        |
| `libs/backend/projects/application`        | application    | `LockProjectForContribution`, `ResolveProjectForRead`, `ListAssignableUsers`; porta `ProjectContributorChanges` em `RemoveProjectMember`, `ChangeProjectMemberRole` e `ApplyOrganizationRoleChange` |
| `libs/backend/organizations/*`             | app/infra      | `LockMembersForShare`; página de owners/admins para elegíveis                                                                                                                                       |
| `libs/backend/shared/infrastructure`       | infrastructure | `PrismaTransactionRunner`: READ COMMITTED explícito e **uma** nova tentativa da transação externa em `P2034` (deadlock/conflito), depois 409 `CONCURRENT_UPDATE`                                    |
| `libs/contracts`                           | contracts      | `tasks.contract.ts` (`strictObject`)                                                                                                                                                                |
| `prisma`                                   | —              | `models/tasks.prisma`; back-relations inertes; migration com FKs compostas, CHECKs e `SET NULL (assignee_user_id)` manual                                                                           |
| `eslint.config.mjs`                        | —              | `tasksMustNotReachOtherContexts`; `organizationsMustNotReachProjects` cobre `assignedTasks`; bloco para `projects` (`tasks`, `taskCounter`, `taskProjectLock`)                                      |
| `apps/api`                                 | app            | Módulo `tasks`, adaptadores, ordem de montagem, casos de isolamento, bateria intra-tenant de tarefas, verificador do invariante BR-003                                                              |
| `apps/web`, `apps/web-e2e`                 | app/e2e        | Aba "Tarefas", criação, detalhe; jornada real                                                                                                                                                       |

## Casos de uso e permissões

**Ordem de decisão**:

- Rotas **endereçadas por tarefa** (`/tasks/{taskId}`, `/tasks/by-key/{key}`): tarefa inexistente, de projeto inexistente ou de projeto sem acesso ⇒ o **mesmo** 404 `TASK_NOT_FOUND` (achado M3); depois permissão (403) e estados.
- Rotas com `projectId` na query ou no corpo: projeto visível (404 `PROJECT_NOT_FOUND`) → permissão (403) → estados.
- Estados: projeto arquivado (409) → tarefa cancelada quando exige ativa (409 `TASK_CANCELED`) → versão (409) → referências (404 `TASK_NOT_FOUND` para pai/bloqueadora; 422 `ASSIGNEE_NOT_PROJECT_MEMBER`; 404 `STATUS_NOT_FOUND`) → regras (422) → limites (422).
- Ator removido entre o middleware e o lock ⇒ 404 `ORGANIZATION_NOT_FOUND` (igual à 003).

**Locks**: toda escrita trava **no máximo uma** linha de `tasks`. Invariantes **entre** tarefas (BR-001, BR-006, ciclos, limites de subtarefas e dependências) são serializadas pela linha de `task_project_locks` do projeto (achados I2b, M2, M5), separada do contador de números.

| Caso de uso                          | Permissão                                           | Lock de projeto em `tasks`           | Regras                                                                                         |
| ------------------------------------ | --------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `CreateTask`                         | `task:create` (+ `task:assign` se vier responsável) | contador; + projeto se for subtarefa | BR-028, um nível, BR-001, BR-003, limites                                                      |
| `ListTasks`, `GetTask` (id ou chave) | `project:read`                                      | —                                    | filtros; transições e ações                                                                    |
| `UpdateTask`                         | `task:update`                                       | projeto se mexer em `isRequired`     | BR-029, BR-008, BR-001, ciclo implícito (D4)                                                   |
| `AssignTask`                         | `task:assign`                                       | —                                    | BR-003 (alvo relido: membership `FOR SHARE`), BR-029, BR-008                                   |
| `TransitionTask`                     | `task:update`                                       | projeto se entrar ou sair de `done`  | BR-004, BR-001, BR-006, BR-029, BR-008                                                         |
| `CancelTask` / `ReopenTask`          | `task:update`                                       | projeto                              | BR-029; BR-001 (subtarefa obrigatória reabrindo com pai em `done`; reabrir pai em `done`)      |
| `DeleteTask`                         | `task:delete` (`own`: tarefa e subtarefas do ator)  | projeto                              | BR-008; cascata                                                                                |
| `AddDependency` / `RemoveDependency` | `task:update`                                       | projeto                              | mesmo projeto, ciclo (com aresta implícita), tetos; duplicada ⇒ 200 idempotente; ausente ⇒ 404 |
| `ListAssignableUsers`                | `task:assign`                                       | —                                    | papel efetivo manager/member                                                                   |
| `RevokeAssignmentsOnAccessLoss`      | — (porta de `projects`)                             | — (na transação do chamador)         | BR-003; ignora BR-026/029; `version + 1`                                                       |

## Modelo de domínio

- **`TaskTitle`** 1–200; **descrição** até 10 000 (por linha); **`Priority`** `none | low | medium | high | urgent`; **`DueDate`** `YYYY-MM-DD`.
- **`Task`**: `create`, `edit`, `setRequired`, `assign`, `transition`, `cancel`, `reopen`; `completedAt`/`completedByUserId` ⇔ status de categoria `done`; `TaskCanceledError` em edições de cancelada.
- **Pendente** = não cancelada e categoria ≠ `done`. **Pai concluído** = categoria `done`, **independentemente de cancelado** (achado M2).
- **Grafo** (BR-006): arestas explícitas + **aresta implícita** "pai bloqueado pelas subtarefas obrigatórias" (D4). BFS por níveis sob o lock do projeto, com teto de **64 níveis** e **500 nós**; excedido ⇒ `DEPENDENCY_LIMIT_REACHED`. Sem CTE recursiva (gatilho do ADR 0014).
- **`taskActions`**: `update`, `assign`, `cancel`, `reopen`, `delete` (com a regra de `own`), `transitionTo` (destinos permitidos pelo workflow; BR-001/006 não entram, a API responde 422 com os ids).

## Modelagem de dados

| Tabela               | Colunas principais                                                                                                                                                                                                                                                                                                                   | Restrições                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks`              | `id`, `organization_id`, `project_id`, `number`, `title`, `description NULL`, `status_id`, `priority`, `assignee_user_id NULL`, `due_date NULL`, `parent_task_id NULL`, `is_required`, `completed_at NULL`, `completed_by_user_id NULL`, `canceled_at NULL`, `canceled_by_user_id NULL`, `created_by_user_id`, `version`, timestamps | `UNIQUE (organization_id, project_id, id)`; `UNIQUE (organization_id, project_id, number)`; FK → `projects` CASCADE; FK `(…, status_id) → workflow_statuses` RESTRICT; **FK `(organization_id, assignee_user_id) → memberships ON DELETE SET NULL (assignee_user_id)`**; FK `(…, parent_task_id) → tasks` CASCADE; CHECKs (título, número ≥ 1, `is_required` só com pai, coerência de conclusão/cancelamento); índices `(org, project, number DESC)`, `(org, assignee_user_id)`, `(org, project, parent_task_id)` |
| `task_dependencies`  | `organization_id`, `project_id`, `blocked_task_id`, `blocking_task_id`, `created_at`                                                                                                                                                                                                                                                 | PK `(project_id, blocked_task_id, blocking_task_id)`; FKs para `tasks` CASCADE (mesmo projeto); CHECK distintas; índice `(org, project, blocking_task_id)`                                                                                                                                                                                                                                                                                                                                                        |
| `task_counters`      | `organization_id`, `project_id`, `next_number`                                                                                                                                                                                                                                                                                       | PK `(organization_id, project_id)`; FK → `projects` CASCADE; `upsert` atômico; teto de 10 000 sobre `next_number` (inclui excluídas)                                                                                                                                                                                                                                                                                                                                                                              |
| `task_project_locks` | `organization_id`, `project_id`                                                                                                                                                                                                                                                                                                      | PK `(organization_id, project_id)`; FK → `projects` CASCADE; linha criada com o contador; `SELECT … FOR UPDATE` serializa invariantes entre tarefas                                                                                                                                                                                                                                                                                                                                                               |

**FKs entre contextos** (ADR 0015; tabela de exceções em `bounded-contexts.md`, com a seta nova `TSK → ORG` para o critério b): `tasks → projects`, `tasks → workflow_statuses` (RESTRICT, não bloqueia revogação; cascata da organização verificada), `tasks → memberships` (SET NULL na coluna), `task_counters → projects`, `task_project_locks → projects`.

**`SET NULL (assignee_user_id)`** (achados A2/I3, verificado pela arquitetura no Prisma 7.10): o Prisma gera `SET NULL` sem lista de colunas (anularia `organization_id`) e não lê `confdelsetcols` — depois do ajuste manual, `migrate diff` sai vazio e uma migration futura que recrie a FK voltaria ao comportamento errado **sem ninguém perceber**. Proteções obrigatórias: (1) teste de catálogo em `pg_constraint` (`confdeltype = 'n'` e `confdelsetcols` = só a coluna do responsável); (2) teste de integração "remover e sair da organização com tarefas atribuídas ⇒ 204 e responsável anulado"; (3) comentário no modelo apontando para os testes; o aviso do `prisma validate` é esperado. Alternativa avaliada e não adotada: coluna sombra `assignee_organization_id` (duplica o tenant para contornar a ferramenta).

## Contratos

Sob `/api/v1/organizations/{organizationId}`; aninhamento além de projeto vira filtro.

| Método | URI (relativa)                                                                                           | Permissão      | Request                                                                                                | Response                                                          |
| ------ | -------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| GET    | `/tasks?projectId&statusId&assigneeUserId&assigned=me\|none&priority&canceled&parentTaskId&limit&cursor` | `project:read` | — (`projectId` obrigatório)                                                                            | `{ items: TaskSummary[], nextCursor }`                            |
| POST   | `/tasks`                                                                                                 | `task:create`  | `{ projectId, title, description?, priority?, assigneeUserId?, dueDate?, parentTaskId?, isRequired? }` | 201 `Task`                                                        |
| GET    | `/tasks/assignable-users?projectId&limit&cursor`                                                         | `task:assign`  | —                                                                                                      | `{ items: [{ userId, name, email, effectiveRole }], nextCursor }` |
| GET    | `/tasks/by-key/{key}`                                                                                    | `project:read` | —                                                                                                      | `Task`                                                            |
| GET    | `/tasks/{taskId}`                                                                                        | `project:read` | —                                                                                                      | `Task`                                                            |
| PATCH  | `/tasks/{taskId}`                                                                                        | `task:update`  | `{ title?, description?, priority?, dueDate?, isRequired?, version }` (≥ 1)                            | `Task`                                                            |
| PUT    | `/tasks/{taskId}/assignee`                                                                               | `task:assign`  | `{ assigneeUserId: uuid \| null, version }`                                                            | `Task`                                                            |
| POST   | `/tasks/{taskId}/transition`                                                                             | `task:update`  | `{ statusId, version }`                                                                                | `Task`                                                            |
| POST   | `/tasks/{taskId}/cancel` · `/reopen`                                                                     | `task:update`  | `{ version }`                                                                                          | `Task`                                                            |
| DELETE | `/tasks/{taskId}?version`                                                                                | `task:delete`  | —                                                                                                      | 204                                                               |
| POST   | `/tasks/{taskId}/dependencies`                                                                           | `task:update`  | `{ blockingTaskId }`                                                                                   | 201/200 `Task`                                                    |
| DELETE | `/tasks/{taskId}/dependencies/{blockingTaskId}`                                                          | `task:update`  | —                                                                                                      | 204                                                               |

- `Task` (detalhe): `id, key, number, projectId, title, description, status { id, name, category }, priority, assignee { userId, name } | null, dueDate, parentTaskId, isRequired, completedAt, canceledAt, createdByUserId, createdAt, version, actions, subtasks, blockedBy, blocking (até 50, com `blockingTruncated`)`.
- Corpos `strictObject`, sem `organizationId`, `number`, `statusId` (na criação), `completedAt`, `createdByUserId`. `isRequired` sem pai ⇒ 422 de domínio (nunca violação de CHECK). Cursor carrega só o número. `by-key` valida `^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}$` na rota (malformada ⇒ 404); `taskId` validado como UUID; rotas literais (`assignable-users`, `by-key`) declaradas antes de `/:taskId`.
- `P2003` em corridas com exclusão (pai/bloqueadora apagados) ⇒ 404 `TASK_NOT_FOUND`.

**Eventos** (log, só ids, após o commit): `tasks.created`, `tasks.updated`, `tasks.assigned` (de/para), `tasks.status_changed` (de/para), `tasks.canceled`, `tasks.reopened`, `tasks.deleted`, `tasks.dependency_added`/`removed`, `tasks.assignments_revoked` (contagem; registrado pela casca do caso de uso que originou, depois do commit dele — nenhum contador de `tasks` vaza para eventos de outros contextos).

## Segurança

- Matriz + papel efetivo relido sob lock; ordem de decisão fixa; 404 uniforme nas rotas por tarefa; `own` sobre tarefa **e** subtarefas.
- **BR-003 sem janela**: atribuição relê o papel do alvo com membership `FOR SHARE` e projeto `FOR SHARE`; perda de acesso decidida em `projects` em todos os caminhos e executada por `tasks` na mesma transação; remoção da organização pelo banco.
- **Isolamento** (harness da 006 ampliado): casos para `taskId`, `key`, `projectId` (query e corpo), `statusId`, `assigneeUserId` (query e corpo), `parentTaskId` (query e corpo), `blockingTaskId`, `cursor`; o filtro "eu/sem responsável" fica em `assigned`, separado do UUID (achado M6.1). **Bateria intra-tenant própria de `/tasks`** com "covers every task route", corpos idênticos oculto × ausente, IDOR entre projetos (pai, bloqueadora, status, responsável e filtros `parentTaskId`/`statusId` de outro projeto ⇒ 404/vazio sem canários). **Teste de reações entre organizações**: membro de A e B rebaixado ou removido em A mantém atribuições em B. **Verificador do invariante BR-003** ao fim de cada teste de concorrência.
- **Abuso**: `tasks.create.user.hour` 300; `tasks.write.user.hour` 1200 (inclui excluir, cancelar, reabrir, atribuir, dependências); 10 000 tarefas por projeto (risco aceito: encher bloqueia a criação no projeto); 100 000 por organização; 100 subtarefas por tarefa; 50 bloqueadoras por tarefa; 5 000 dependências por projeto; BFS 64 níveis/500 nós; `lock_timeout` de 2 s nas escritas de tarefa.

## Concorrência e consistência

**Ordem única de locks**: projeto (`projects`) `FOR SHARE` → memberships `FOR SHARE` → contador ou lock do projeto em `tasks` → **uma** linha de `tasks`.

**Invariante nova** (substitui a obrigação 2 da 003, insuficiente para owner/admin): nenhuma mudança de papel efetivo acontece sem travar a linha da membership (`organizations`) ou o projeto em `FOR NO KEY UPDATE` (`projects`); e nenhuma transação trava `projects` depois de travar uma membership. Por isso a participação é lida sem lock em `lockForContribution`.

- Escritores de várias linhas de `tasks` (reação de desatribuição, `SET NULL` da FK, cascata de exclusão) não esperam por linhas que um escritor de uma linha segure em ordem inversa; o retry único em `P2034` do runner cobre o residual, e o teste de RNF-02 é "sem deadlock **não recuperado**", com intercalação explícita reação × transição.
- BR-001: concluir/reabrir o pai e criar/reabrir/tornar obrigatória uma subtarefa passam pelo lock do projeto em `tasks`.
- BR-006 e D4: dependências e `isRequired` passam pelo mesmo lock.
- BR-028: `upsert` atômico do contador; número único também por índice.

## Transição para as specs 005/007/008 (obrigações registradas)

1. **005**: mover card chama o núcleo de `TransitionTask` dentro da transação de `boards` e registra os eventos depois do próprio commit; edição de status/transições trava o projeto em `FOR NO KEY UPDATE`; mudar a categoria de um status em uso recalcula `completed_at`; remover status em uso exige migrar as tarefas (FK RESTRICT); teste de cascata da exclusão da organização em integração.
2. **007**: `sprint_tasks → tasks` CASCADE dentro do ADR 0015; concluída/cancelada pela porta.
3. **008**: `TaskAssigned`/`TaskCompleted` saem do núcleo como eventos de integração (outbox).

## Decisões arquiteturais

| Decisão             | Alternativas                                   | Escolha e motivo                                                                    | ADR              |
| ------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------- |
| Perda de acesso     | dois ouvintes com regra em `tasks` (revisão 1) | **`projects` decide, `tasks` executa** (regra única, cadeia linear)                 | 0013             |
| FK do responsável   | `project_members`; coluna sombra               | **`memberships` com `SET NULL (coluna)` + teste de catálogo + teste de remoção**    | 0015 (critérios) |
| Locks entre tarefas | pai + filha (revisão 1)                        | **Uma linha de tarefa por escrita + lock do projeto em `tasks`** + retry em `P2034` | —                |
| Numeração           | `MAX+1`; sequence                              | **Contador com `upsert`**, separado do lock do projeto                              | —                |
| Ciclos              | CTE recursiva                                  | **BFS por níveis com aresta implícita (D4) e tetos**                                | —                |

Nenhum ADR novo: cabe nos ADRs 0003, 0013 e 0015. Atualizações no mesmo commit da spec: `bounded-contexts.md` (seta `TSK → ORG`, exceções, invariante de locks), design da 003 (revisão registrando a substituição das obrigações 2 e 3), `business-rules.md` (BR-001, BR-003, BR-028, BR-029).

## Pontos de decisão para aprovação

- **D1 — Esclarecimento da BR-001**: a invariante vale sempre — criar ou tornar obrigatória, reabrir ou tirar de `done` uma subtarefa obrigatória de pai concluído, ou reabrir um pai em `done` com obrigatória pendente ⇒ 422 `PARENT_TASK_COMPLETED` / `TASK_HAS_PENDING_REQUIRED_SUBTASKS` (o código canônico `TASK_ALREADY_COMPLETED` da BR-001 é renomeado para `PARENT_TASK_COMPLETED`).
- **D2 — BR-006 como precondição**: concluída pode ganhar bloqueador; reabrir o bloqueador não "desconclui".
- **D3 — Limites** (seção Segurança).
- **D4 — Ciclo implícito BR-001 × BR-006**: subtarefa obrigatória não pode ser bloqueada (direta ou indiretamente) pelo próprio pai (recomendado), em vez de aceitar o impasse e documentar "cancele a subtarefa".
- **D5 — Exclusão pelo member**: só quando a tarefa e todas as subtarefas são dele (recomendado); senão, só manager.

## Riscos

| Risco                                              | Probabilidade | Impacto | Mitigação                                                               |
| -------------------------------------------------- | ------------- | ------- | ----------------------------------------------------------------------- |
| Migration futura perder o `SET NULL (coluna)`      | Média         | Alto    | Teste de catálogo + teste de remoção na CI                              |
| Deadlock residual                                  | Baixa         | Médio   | Uma linha por escrita; retry `P2034`; intercalações testadas            |
| Caminho novo de perda de acesso sem chamar a porta | Média         | Alto    | Regra única em `projects`; verificador do invariante BR-003 nos testes  |
| Contenção no lock do projeto em `tasks`            | Média         | Baixo   | Só operações de invariantes entre tarefas; BFS limitada; `lock_timeout` |

## Histórico de revisões

| Revisão | Origem                  | Mudanças principais                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Autor                   | Versão inicial                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2       | Arquitetura e segurança | Regra de perda de acesso só em `projects` (porta `ProjectContributorChanges`, um ouvinte); ordem de montagem; uma linha de tarefa por escrita + `task_project_locks` + retry `P2034` + READ COMMITTED; `SET NULL (coluna)` com teste de catálogo; 404 uniforme nas rotas por tarefa; `own` com subtarefas; aresta implícita e tetos da BFS; lints; harness e bateria de tarefas; workflow no retorno do lock; núcleo × casca para eventos; D4, D5 |
