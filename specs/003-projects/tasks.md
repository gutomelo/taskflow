# 003 — Projetos · Tarefas

Regras: uma tarefa por vez; marcar `[x]` somente com evidência executada (seção abaixo). Toda tarefa termina com `pnpm nx affected -t lint typecheck test` passando; tarefas com persistência, portas entre contextos ou harness também com `pnpm test:integration`. Mutation testing manual registrado por tarefa.

## Bloco A — Domínio e persistência

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                                                                                                  | Depende de | Verificação                                                                                                                                                                                                               | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T1  | Bibliotecas `libs/backend/projects/{domain,application,infrastructure,http}` com tags `scope:backend`, `domain:projects`, `type:*`. Domínio: `ProjectKey` (BR-025), `ProjectName`, `ProjectDescription`, `Project` (editar, arquivar/restaurar, BR-026), `ProjectMember` (teto, `capToViewer`, BR-027), `projectCapabilities`, `participantActions`, `defaultWorkflow`, erros, contratos de repositório | —          | testes de domínio nomeados BR-025/026/027; tabela de capacidades × arquivado; lint de boundaries                                                                                                                          | [x]    |
| T2  | `prisma/models/projects.prisma` + migration: tabelas, enums, CHECK da chave, FKs compostas, FK para `memberships` em cascata (ADR 0015) com back-relation inerte comentada; cabeçalhos de `schema.prisma`/`organizations.prisma`; lint que barra a back-relation e os delegates de `projects` em `organizations`                                                                                        | T1         | `prisma validate`; `migrate diff` sem diferenças; integração: CHECK, unicidade da chave por organização, FK impede participação de não membro, cascata ao apagar membership, transição entre projetos diferentes recusada | [x]    |
| T3  | Repositórios Prisma de `projects` (sempre com `organizationId`; participação por `(organizationId, projectId, userId)`; keyset; `P2002`/`P2003` mapeados; lock `FOR NO KEY UPDATE` do projeto com `transactionalClient`)                                                                                                                                                                                | T2         | integração dos repositórios, inclusive página sem N+1 e versão (BR-008)                                                                                                                                                   | [x]    |

## Bloco B — Portas entre contextos e aplicação

| ID  | Tarefa                                                                                                                                                                                                                                                                                                            | Depende de | Verificação                                                                                                                                           | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T4  | `organizations`: casos de uso `LockOrganizationForShare` (`FOR SHARE` com `transactionalClient`, papéis em lote, `null` ⇒ 404), `GetMemberRoles`, `ListMembersExcluding`; porta `MembershipRoleChanges` chamada por `ChangeMemberRole` sempre que o papel muda, com `cappedProjectParticipations` no evento       | T3         | fakes; integração: lock segurado até o commit bloqueia `lockForMembershipChange` de outra conexão; lança fora de transação; testes da spec 002 verdes | [x]    |
| T5  | `projects/application`: portas `OrganizationAccess` e `UserDirectory`; `CreateProject`, `ListProjects`, `GetProject` (`by: id \| key`, consulta única com visibilidade), `GetWorkflow`, `UpdateProject`, `ArchiveProject`, `RestoreProject`; ordem de decisão fixa; limites; eventos após o commit                | T1, T4     | fakes: CA-01, CA-02, CA-03, CA-04, CA-05; ordem de erros (403 antes de `PROJECT_KEY_TAKEN`); idempotência antes da versão                             | [x]    |
| T6  | `projects/application`: `ListProjectMembers`, `ListMemberCandidates`, `AddProjectMember`, `ChangeProjectMemberRole`, `RemoveProjectMember` (outro/sair), `ApplyOrganizationRoleChange` (BR-027, incrementa versão)                                                                                                | T5         | fakes: CA-06, CA-07, IDOR entre projetos; ações por participante                                                                                      | [x]    |
| T7  | Composição em `apps/api` (ordem de montagem, adaptadores, instância única do runner, mapas de erro com teste de colisão de códigos); integração concorrente: rebaixar × promover (nas duas ordens), desligar configuração × criar, edições na mesma versão; BR-027 "remover e reconvidar" e "rebaixar e promover" | T4, T6     | integração: CA-08 e concorrência; nenhum teto violado                                                                                                 | [x]    |

## Bloco C — HTTP, isolamento e autorização

| ID  | Tarefa                                                                                                                                                                                                                                                                                 | Depende de | Verificação                                                                                                                                | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| T8  | `libs/contracts/projects` (schemas `strictObject`), router (`by-key` antes de `:projectId`), mapeamento de erros, limites de taxa, OpenAPI                                                                                                                                             | T7         | Supertest: status e contratos, 400/403/404/409/422/429; OpenAPI válido                                                                     | [x]    |
| T9  | Harness: `noStore` por identidade; casos com schemas de entrada e `coverageGaps` derivando referências `*Id`/`cursor` de corpo e query; mundo A/B com projeto real de A e B semeado; `code` esperado por variante; ator membro de A e participante em B; casos de todas as rotas novas | T8         | lacunas fazem o teste falhar (rota sem caso, corpo sem schema, campo `*Id` sem variante — verificado e removido); integração verde (CA-09) | [x]    |
| T10 | Bateria de autorização intra-tenant gerada das rotas de projeto: papel na organização × participação; não participante ⇒ 404 idêntico; 403 antes de erros de estado; IDOR entre projetos                                                                                               | T9         | integração (CA-03, CA-07)                                                                                                                  | [x]    |

## Bloco D — Frontend e jornada

| ID  | Tarefa                                                                                                                                                                                                                 | Depende de | Verificação                                                                                                | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- | ------ |
| T11 | `features/projects`: data-access, guards de contrato, lista (filtro de arquivados, estados), criação com sugestão de chave, link "Projetos" na área da organização                                                     | T8         | testes de componente: lista, vazio, erro, criação com erros de chave, botão só com `can('project:create')` | [x]    |
| T12 | Área `/o/:slug/projects/:key` (resolver, recriação ao trocar a chave, `ActiveProjectStore.can`), visão geral com workflow, configurações (editar, arquivar, restaurar), participantes (ações da API, candidatos, sair) | T11        | testes de componente (CA-10, ações só com capacidade, arquivado sem edições, 404 volta à lista)            | [x]    |
| T13 | E2E real: criar projeto, adicionar participante, arquivar e restaurar; jornadas existentes verdes                                                                                                                      | T12        | Playwright no banco `taskflow_e2e` e Redis índice 2                                                        | [x]    |

## Bloco E — Documentação e validação

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                                                           | Depende de | Verificação                                                           | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- | ------ |
| T14 | ADR 0015 aceito; `bounded-contexts.md` (projects implementado, tabela de exceções, seta `ORG → PRJ` síncrona), `dependency-rules.md` (bibliotecas de `projects`), `business-rules.md` (BR-025…027, BR-004 parcial, BR-023/024 aplicadas), `authorization.md` (estado de projeto), `multi-tenancy.md` (harness ampliado), `testing.md`; índice de specs e roadmap | T1–T13     | verificação de links                                                  | [x]    |
| T15 | `/review-code` e `/security-audit`; correções; gate final                                                                                                                                                                                                                                                                                                        | T14        | sem bloqueantes / sem Críticos-Altos; `pnpm verify`, integração e E2E | [x]    |

## Evidências

### T1 — 2026-10-13

- **Entregue**:
  - bibliotecas `libs/backend/projects/{domain,application,infrastructure,http}` com tags `scope:backend`, `domain:projects`, `type:*` (configuração copiada de `organizations`) e aliases em `tsconfig.base.json`;
  - domínio: `ProjectKey` (BR-025, sem normalização), `ProjectName`, `parseProjectDescription` (normaliza linha a linha e preserva quebras), `Project` (editar só ativo, arquivar/restaurar idempotentes — BR-026), `ProjectMember` com `assignableProjectRoles` (teto; owner/admin nunca gravados — D1), `projectCapabilities` (grants `allow`; arquivado ⇒ ler e restaurar), `participantActions`, `defaultWorkflow`, erros com `code` estável (`MEMBER_NOT_FOUND` reutilizado de propósito) e contratos `ProjectRepository`/`ProjectMemberRepository`.
- **Testes** (39): chaves válidas e inválidas (BR-025), nome e descrição, BR-026, BR-027 (tabela do teto, viewer, owner/admin, troca de papel), capacidades por papel e arquivado, ações por participante, workflow padrão.
- **Mutation testing**, 7/7 detectados: teto do viewer removido; owner/admin gravados; arquivado sem desconto de capacidades; "remover" sobre si; chave aceitando minúsculas; edição em arquivado; arquivar não idempotente.
- **Comandos**: `nx run-many -t lint typecheck test -p backend-projects-domain` ✔; `nx affected -t lint typecheck test` ✔.

### T2 — 2026-10-13

- **Entregue**:
  - `prisma/models/projects.prisma`: `Project`, `ProjectMember`, `WorkflowStatus` e `WorkflowTransition`, enums `project_role` e `status_category`, FKs compostas com `organization_id` e a FK `project_members (organization_id, user_id) → memberships` em cascata (ADR 0015);
  - back-relation inerte `Membership.projectParticipations`, comentada; cabeçalhos de `schema.prisma` e `organizations.prisma` apontam o ADR 0015;
  - migration `20261013191533_add_projects`, gerada por `migrate dev --create-only` no banco descartável `taskflow_e2e`, com CHECKs manuais (formato da chave, nome normalizado, descrição não vazia, nome e posição de status, transição entre status diferentes). Aplicada só ao `taskflow_e2e`;
  - lint `organizationsMustNotReachProjects`, exportado pelo `eslint.config.mjs` da raiz e incluído nos configs das quatro bibliotecas de `organizations`. Os seletores de `params.organizationId` viraram a constante `TENANT_PARAM_RESTRICTIONS`, repetida no bloco novo: no flat config, um segundo `no-restricted-syntax` substitui o primeiro.
- **Verificação**:
  - `prisma validate` ✔; `prisma migrate diff --from-config-datasource --to-schema prisma --exit-code` contra o banco migrado: "No difference detected" (a FK entre contextos não vira drift).
  - Integração (`backend-projects-infrastructure`, 7): formato da chave, unicidade por organização inclusive arquivado, FK recusa não membro e membro de outra organização, cascata ao apagar a membership, participação em projeto de outra organização recusada, transição só entre status do mesmo projeto e diferentes, cascata ao apagar o projeto.
  - Amostra de lint via `eslint --stdin`: 7 violações em `organizations` (5 do tenant e 2 da back-relation) e 5 em `apps/api`.
  - Integração de `organizations` (28) e da API (5) verdes.
- **Correção no caminho (design revisão 3)**: `.claude/rules/database.md` exige FK para a organização em toda tabela tenant-scoped, e o rascunho a omitia (o sintoma: `TRUNCATE organizations CASCADE` não limpava projetos). A migration `20261013191945_add_projects_organization_fk` (roll-forward, porque a primeira já estava aplicada no banco do E2E) acrescenta `projects.organization_id → organizations` em cascata. Ela é a segunda exceção listada no ADR 0015; a back-relation `Organization.projects` foi incluída no lint, e a regra de banco foi atualizada com a exceção. Teste novo: projeto de organização inexistente é recusado e apagar a organização apaga os projetos (8/8); mutante "FK removida" morto.
- **Mutation testing**, 4/4 detectados nas migrations: CHECK da chave removido; FK para `memberships` com `RESTRICT`; FK da transição sem `project_id`; FK para `organizations` removida.
- **Comandos**: `nx affected -t lint typecheck test` ✔ (21 projetos); `nx run-many -t integration-test -p backend-projects-infrastructure backend-organizations-infrastructure api` ✔.

### T3 — 2026-10-13

- **Entregue** (`libs/backend/projects/infrastructure`):
  - `PrismaProjectRepository`:
    - `add` com workflow, na transação (`transactionalClient`; `P2002` ⇒ `ProjectKeyTakenError`);
    - `findVisible` por id ou chave com o filtro de visibilidade na mesma consulta (BR-023);
    - `listVisiblePage` com keyset `(name, id)` e filtro de arquivados;
    - `lockForUpdate` com `FOR NO KEY UPDATE` (só em transação);
    - `save` com versão (BR-008);
    - `findWorkflow`.
  - `PrismaProjectMemberRepository`:
    - participação sempre por `(organizationId, projectId, userId)`;
    - `P2002` ⇒ `AlreadyAProjectMemberError`; `P2003` ⇒ `NotAnOrganizationMemberError` (FK do ADR 0015);
    - keyset `(createdAt, userId)`, `save` e `remove` com versão;
    - `capToViewer` (só em transação, incrementa a versão).
  - Mappers que falham alto com papel ou categoria desconhecidos; cursor opaco validado.
  - `shared/infrastructure`: `isForeignKeyViolation` e os tipos `ProjectRow`, `ProjectMemberRow`, `WorkflowStatusRow` e `WorkflowTransitionRow`.
- **Testes** (integração: 9 novos, total 17 no projeto):
  - chave repetida;
  - workflow gravado e isolado por organização;
  - visibilidade por id e por chave (participante, de fora, owner/admin, outra organização);
  - lista por nome paginada, ativos × arquivados e cursor inválido;
  - lock fora de transação lança; versão desatualizada ⇒ conflito; lock em outra organização ⇒ `null`;
  - duplicidade e não membro;
  - sem IDOR entre projetos;
  - paginação de participantes;
  - rebaixamento a viewer só na organização pedida (usuário membro de A e de B), com versão incrementada.
- **Mutation testing**, 7/7 detectados:
  - visibilidade ignorada;
  - remoção sem `projectId`;
  - rebaixamento sem `organizationId` — **sobreviveu na primeira rodada** e o teste foi reforçado com um usuário membro das duas organizações;
  - `save` sem versão;
  - filtro de arquivados ignorado;
  - `P2003` sem tradução;
  - rebaixamento sem incrementar a versão.
- **Observação**: `lockForUpdate` usa `$queryRaw` parametrizado só para o lock, com `organization_id` no filtro, como `lockForMembershipChange`. Não é leitura de dados de tenant por SQL raw (gatilho do ADR 0014).
- **Comandos**: `nx run backend-projects-infrastructure:integration-test` ✔ 17/17; `nx affected -t lint typecheck test` ✔ (21 projetos).

### T4 — 2026-10-13

- **Entregue**:
  - `organizations/domain`: `OrganizationRepository.lockForShare` e `MembershipRepository.rolesOf` / `listPageExcluding`, com implementações Prisma. O `lockForShare` faz `SELECT … FOR SHARE` por `transactionalClient`, então falha fora de transação.
  - `organizations/application`:
    - casos de uso `LockOrganizationForShare` (sem `TransactionRunner.run` de propósito: fora de transação, lança em vez de abrir uma transação própria e soltar o lock), `GetMemberRoles` e `ListMembersExcluding`;
    - porta `MembershipRoleChanges`, que `ChangeMemberRole` chama sempre que o papel muda, depois do `save` e na mesma transação;
    - `cappedProjectParticipations` no evento `organizations.member_role_changed`;
    - fakes `lockForShare`, `rolesOf`, `listPageExcluding` e `RecordingMembershipRoleChanges`.
  - **Antecipado da T6**: `ApplyOrganizationRoleChangeUseCase` em `projects/application` (BR-027: só `toRole = viewer` rebaixa; incrementa a versão; sem evento próprio). Ele depende só do repositório de participações, e ligar a porta de verdade em `main.ts` sem ele exigiria um stub. Os fakes em memória de `projects` (`createProjectsTestbed`) também entraram já completos.
  - `apps/api`:
    - `adapters/membership-role-changes.adapter.ts`;
    - `projects.module.ts` com `createProjectsFoundation` (passo 1 da ordem de montagem do design);
    - `organizations.module` recebe `membershipRoleChanges` e expõe `access` (`lockForShare`, `rolesOf`, `membersExcluding`);
    - `main.ts` e o teste de isolamento montam nessa ordem, com a mesma instância do runner.
- **Testes**:
  - aplicação de `organizations` (95):
    - a porta é chamada dentro da transação, com `fromRole`/`toRole`;
    - a contagem vai para o evento;
    - não é chamada sem mudança;
    - falha na reação desfaz o papel e não emite evento;
    - os casos de uso de acesso (configuração e papéis só de membros, `null`, sem lock nas leituras, página excluindo usuários).
  - Aplicação de `projects` (5): BR-027 rebaixa só na organização pedida e incrementa versões; promover não restaura; fora de transação lança.
  - Integração de `organizations` (32):
    - `lockForShare` falha fora de transação e devolve `null` para organização inexistente;
    - **segura `lockForMembershipChange` de outra transação até o commit**;
    - dois `FOR SHARE` correm em paralelo;
    - `rolesOf` só da organização pedida;
    - `listPageExcluding`.
  - Integração da API (5) verde com a nova composição.
- **Mutation testing**, 6/6 detectados: porta não chamada; `SELECT` sem `FOR SHARE`; lock fora de transação (`client()`); papéis sem `organizationId`; exclusão ignorada; rebaixamento em qualquer mudança de papel.
- **Comandos**: `nx affected -t lint typecheck test` ✔ (21 projetos); `nx run backend-organizations-infrastructure:integration-test` ✔ 32/32; `nx run api:integration-test` ✔ 5/5.

### T5 — 2026-10-13

- **Entregue** (`libs/backend/projects/application`):
  - portas `OrganizationAccess` (`lockForShare`, `rolesOf`, `listMembersPage`) e `UserDirectory`;
  - erros de aplicação (`PROJECT_NOT_FOUND`, `PROJECT_MEMBER_NOT_FOUND`, limites; `ORGANIZATION_NOT_FOUND` e `INSUFFICIENT_ROLE` reutilizados de propósito);
  - limites (1000 projetos por organização, 500 participantes, `projects.create.user.hour` = 30);
  - eventos de segurança `projects.*`;
  - views com `myRole` e `capabilities`;
  - auxiliar `lockProjectAndRereadActor` com a ordem única de locks e de decisão;
  - casos de uso `CreateProject` (taxa contada antes de tudo; negação rápida só do `deny`; configuração e papel relidos sob `FOR SHARE`; D1), `ListProjects`, `GetProject` (`by: id | key`), `GetWorkflow`, `UpdateProject`, `ArchiveProject` e `RestoreProject` (idempotência antes da versão).
  - `toPageRequest` e os tetos de paginação foram para `shared/application`: agora dois contextos os usam. `organizations` reexporta, sem mudar imports.
- **Testes** (aplicação de `projects`: 24):
  - CA-01: owner/admin criam sem ser gravados (D1); member vira manager; workflow padrão; evento após o commit;
  - BR-024: configuração desligada; viewer negado sem travar;
  - papel relido sob lock na criação e na escrita;
  - CA-02: chave inválida, repetida e em outra organização; 403 antes de chave em uso; nada sobra da tentativa;
  - limite e taxa;
  - CA-03: visibilidade na lista (página cheia) e por id/chave/workflow;
  - CA-04: viewer com participação manager lê como viewer; owner não participante lê como manager;
  - CA-05: edição com versão, 403/404, arquivado × versão, idempotência, restauração e eventos.
- **Mutation testing**, 8/8 detectados:
  - configuração ignorada; owner gravado como participante; sem negação rápida; permissão ignorada; versão antes de arquivado; arquivar sem idempotência;
  - dois sobreviveram na primeira rodada e os testes foram reforçados:
    - papel do middleware na escrita (teste: admin rebaixado e não participante ⇒ 404);
    - "todos veem tudo" (teste de página cheia).
- **Comandos**: `nx run-many -t lint typecheck test -p backend-projects-application` ✔; `nx affected -t lint typecheck test` ✔.

### T6 — 2026-10-13

- **Entregue** (`libs/backend/projects/application`):
  - `ListProjectMembers`: papel gravado e efetivo, ações do leitor, consultas fixas por página;
  - `ListMemberCandidates`: exige `project-member:manage`; arquivado ⇒ 409; exclui participantes e owner/admin **na consulta** (D1);
  - `AddProjectMember`: ordem de decisão fixa (visível → permissão → arquivado → alvo membro → D1 e teto → duplicidade → limite);
  - `ChangeProjectMemberRole`: participação por organização, projeto e usuário; arquivado ⇒ 409; versão; ações com o papel relido, ou o novo se o ator mudou o próprio;
  - `RemoveProjectMember`: outro exige `project-member:manage`; sair só exige participar; permitido em arquivado;
  - views `ProjectMemberView` e `MemberCandidateView`;
  - auxiliar de leitura `findReadableProject`, extraído para `shared/project-read.ts`.
  - `ApplyOrganizationRoleChange` foi antecipado na T4.
  - **Ajuste na T4**: `listPageExcluding` (repositório, Prisma, fake e caso de uso de `organizations`) passou a receber os papéis aceitos. Os candidatos excluem owner/admin na própria consulta, e as páginas vêm cheias. Os testes de `organizations` foram atualizados (95 unitários, 32 de integração).
- **Testes** (aplicação de `projects`: 38, sendo 14 novos):
  - CA-06: adicionar com ações; não membro e membro de outra organização ⇒ o mesmo 404; teto do viewer; owner/admin recusados (D1); duplicidade; limite por último;
  - 403 antes de qualquer erro de estado e 404 para quem não participa;
  - arquivado;
  - CA-07: mudar papel e remover com versão; **IDOR P1 × P2** (404 e P2 intacto); teto na mudança; member não remove outros; sair, inclusive o único manager; arquivado (sem mudança de papel, com remoção e saída); ações depois de rebaixar a si mesmo;
  - lista de participantes com papel efetivo, ações por leitor e um lote de contas por página;
  - candidatos sem participantes, owner e admin, com `allowedRoles`, 403 e arquivado.
- **Mutation testing**, 7/7 detectados: arquivado ignorado ao adicionar; sem checagem de duplicidade; sair exigindo `manage`; candidatos com owner/admin; candidatos em arquivado; mudar papel em arquivado; candidatos sem permissão.
- **Comandos**: `nx affected -t lint typecheck test` ✔; `nx run backend-organizations-infrastructure:integration-test` ✔ 32/32.

### T7 — 2026-10-13

- **Entregue** (`apps/api`):
  - adaptadores `organization-access.adapter.ts` (porta `OrganizationAccess` → `LockOrganizationForShare`, `GetMemberRoles` e `ListMembersExcluding`) e `project-user-directory.adapter.ts` (só nome e e-mail de `identity`);
  - `createProjectsModule` sobre a fundação, com os casos de uso e eventos `projects.*` no log estruturado.
  - Ordem de montagem verificada: fundação → `organizations` com `membershipRoleChanges` → `projects` com `organizationAccess`, com uma única instância do runner.
  - O teste de colisão de códigos de erro e a ligação do router em `main.ts` ficam para a T8, junto com os mapeamentos HTTP (até lá, `main.ts` só monta a fundação).
- **Testes** (integração da API: `projects-composition.integration.spec.ts`, 8 testes, mais os 5 de isolamento):
  - a porta de acesso lança fora de transação;
  - BR-027 "rebaixar e promover" (participações viram viewer na mesma transação, versão + 1, e não voltam);
  - BR-027 "remover e reconvidar" (cascata; ao reentrar, nenhuma participação);
  - **CA-08 nas duas ordens**:
    - promoção segurando o `FOR SHARE` vence, e o rebaixamento a limita depois;
    - rebaixamento segurando o lock da organização vence, e a promoção recebe 409 (versão incrementada pelo rebaixamento), seguida de teto com a versão atual;
  - BR-024: criação concorrente com o desligamento da configuração espera e é recusada, sem projeto criado;
  - outra conexão segurando `FOR NO KEY UPDATE` atrasa a adição de participante até o commit;
  - BR-008: duas edições na mesma versão, só uma vence.
- **Ajuste**: a asserção do segundo cenário de CA-08 aceitava "teto ou conflito"; virou exata (409 e, com a versão atual, teto).
- **Mutation testing**, 2/2 detectados: `SELECT` sem `FOR SHARE` (4 testes falham); reação a mudança de papel desligada no adaptador (3 falham).
- **Comandos**: `nx run api:integration-test` ✔ 13/13; `nx affected -t lint typecheck test` ✔.

### T8 — 2026-10-13

- **Entregue**:
  - `libs/contracts/projects`: schemas `strictObject` de entrada (criar, atualizar com ≥ 1 campo e sem chave, versão, adicionar participante com `userId` UUID, mudar papel), respostas, páginas, workflow, candidatos, `projectPermissionSchema` / `projectRoleSchema` / `statusCategorySchema` espelhados.
  - `libs/backend/projects/http`:
    - `createProjectsRouter`: só rotas tenant-scoped relativas, `no-store`, parâmetros malformados ⇒ 404, `Location` na criação;
    - limites de borda `projects.members.write.user` (120/h) e `projects.archive.user` (30/h);
    - `projectsErrorMappings`, OpenAPI (9 caminhos) e teste de paridade kernel/domínio × contracts.
  - `apps/api`:
    - `createProjectsModule` devolve `tenantRouter` e `domainErrors`;
    - `composeApiRouters` exige `projects` (o tipo obriga `main.ts` e os testes de rotas a montá-lo);
    - `main.ts` monta `projects` (fundação → `organizations` → `projects`);
    - `mergeDomainErrors` falha na montagem se dois contextos mapearem o mesmo código de formas diferentes (S-7), com teste sobre os mapas reais;
    - OpenAPI com os caminhos de projetos.
- **Testes**:
  - contracts (+4): mass assignment, atualização sem campo ou com chave, `userId` e papel, filtro de status;
  - HTTP (10): criação com `Location` e `no-store`, chave inválida ou em uso, `organizationId` no corpo ⇒ 400; lista e leitura por id e chave; **404 idêntico** para oculto, inexistente e por chave; parâmetros malformados; edição com versão, arquivar e restaurar; workflow; participantes (lista, candidatos, 404/422/409, adicionar, mudar, remover, sair); 403 antes de erros de estado; 429 com `Retry-After`; paridade;
  - API: OpenAPI descreve os 13 endpoints de projetos com 404; colisão de mapeamentos.
- **Mutation testing**, 3/3 detectados (`no-store` removido, escrita de participantes sem limite, filtro de arquivados invertido) e 1 **equivalente**: a ordem `by-key` × `:projectId` não importa, porque os caminhos têm números de segmentos diferentes. O comentário do router e a frase do design que diziam o contrário foram corrigidos.
- **Pendente de propósito, para a T9**: `route-coverage.spec.ts` falha com as 13 rotas novas sem caso de isolamento (saída registrada na T9), e o teste de isolamento ainda não monta `projects`. É o harness da 006 funcionando.
- **Comandos**: `nx run-many -t lint typecheck test -p contracts backend-projects-http` ✔.

### T9 — 2026-10-13

- **Antes**: com as rotas de projetos montadas e sem casos, `route-coverage.spec.ts` falhou listando as 13 rotas novas como `no isolation case` (saída da T8). É a prova de que uma rota nova não passa despercebida.
- **Entregue** (`apps/api/src/testing` e `shared/http`):
  - `noStore` exportado de `shared/http` e usado pelos dois routers; o harness o reconhece **por identidade** (`CONTEXT_MIDDLEWARES` guarda a função, não o nome). Cumpre a obrigação 6 da 006.
  - `IsolationCase` com `body` e `query` **obrigatórios** (schema de `libs/contracts` ou `null`): esquecer não compila. `coverageGaps` deriva das chaves do schema as referências `…Id` e `cursor` e exige variante para cada uma; rota POST/PATCH/PUT sem schema de corpo ⇒ lacuna.
  - Variantes com `code` esperado (o harness confere o código, não só o 404) e `actors` (`owner-of-A` ou `both`).
  - `IsolationWorld`:
    - `ofA` (projeto real de A com chave e participante) para trocar **uma** referência por vez;
    - B semeado com 2 projetos, participantes, workflow, 2 convites e cursores reais de B (membros, projetos, participantes);
    - **segundo ator, membro de A e de B**, manager do projeto de A e participante de um projeto de B; seu id sai dos canários.
  - 22 casos: os 9 de `organizations` ganharam corpo/query declarados e variantes de `cursor`; os 13 de `projects` cobrem `projectId`, `key`, `userId` de caminho e de corpo, e `cursor`.
- **Testes**:
  - unitários da API (45): referências de corpo e query derivadas dos schemas; corpo sem schema; `noStore` homônimo recusado e o compartilhado aceito;
  - integração (13): os casos gerados (prefixo de B ⇒ 404 `ORGANIZATION_NOT_FOUND`) e as variantes nos dois atores, com códigos `PROJECT_NOT_FOUND`, `MEMBER_NOT_FOUND`, `PROJECT_MEMBER_NOT_FOUND` e `INVITATION_NOT_FOUND`, snapshot de B intacto e nenhum canário de B nas respostas de A.
- **Mutation testing**, 3/3 detectados pela integração: `findVisible` sem `organizationId`; lista sem `organizationId`; **mesmo status com código diferente** (`PROJECT_NOT_FOUND` no lugar de `PROJECT_MEMBER_NOT_FOUND`). O terceiro morreu primeiro por um `ReferenceError` (import ausente no mutante); foi refeito com o import e morreu pela conferência do código.
- **Comandos**: `nx run api:test` ✔ 45; `nx run api:integration-test` ✔ 13/13; `nx affected -t lint typecheck test` ✔.

### T10 — 2026-10-13

- **Entregue**:
  - `apps/api/src/testing/integration-api.ts` (`startIntegrationApi`): a API real com PostgreSQL efêmero e a mesma composição de `main.ts`. O teste de isolamento passou a usá-lo, sem duplicar a montagem.
  - `projects-authorization.integration.spec.ts`: bateria gerada das rotas reais filtradas por `/projects/:projectId` e `/projects/by-key/`, com uma tabela de requisições (leitura × gestão) que **falha se surgir rota de projeto sem entrada**.
- **Testes** (integração da API: 18, sendo 5 novos):
  - cobertura da tabela;
  - **CA-03**: member e viewer da organização que não participam recebem, em todas as rotas, o **mesmo corpo** (`status`, `code`, `title`) que receberiam para um projeto inexistente (`instance` e `requestId` à parte); sair de projeto do qual não participa também dá 404;
  - **CA-03**: participantes `member` e `viewer` recebem 403 `INSUFFICIENT_ROLE` em toda rota de gestão, com dados que gerariam 409 ou 422 se a permissão viesse depois; leituras dão 200;
  - owner e admin não participantes e o manager leem tudo e veem candidatos;
  - **CA-07 (IDOR)**: o manager de P1 alterando ou removendo quem só participa de P2 recebe 404 `PROJECT_MEMBER_NOT_FOUND`, P2 fica intacto e o acesso direto a P2 dá 404.
- **Mutation testing**, 2/2 detectados: 403 no lugar de 404 para quem não participa (vazaria existência); duplicidade checada antes da permissão (oráculo de participação).
- **Comandos**: `nx run api:integration-test --skip-nx-cache` ✔ 18/18; `nx affected -t lint typecheck test` ✔.

### T11 — 2026-10-13

- **Entregue** (`apps/web/src/app/features/projects`):
  - `projects-contract-guards.ts`: verificações de forma, sem Zod no bundle; capacidades desconhecidas aceitas e nunca casam;
  - `ProjectApi`: todas as chamadas com o id explícito da organização (`tenantUrl`, ADR 0012);
  - `project-key.ts`: sugestão por iniciais ou pelas três primeiras letras, sem acento; normalização do que é digitado; formato da BR-025;
  - `ProjectsListPage`: skeleton, vazio, erro com nova tentativa, filtro Ativos/Arquivados com `aria-pressed`, "Carregar mais" uma página por vez, respostas de filtro antigo descartadas, botão "Novo projeto" só com `can('project:create')`;
  - `CreateProjectPage`: chave acompanha o nome até ser editada e vira maiúsculas ao digitar; erros da API no campo (`PROJECT_KEY_TAKEN`, `INVALID_PROJECT_*`) com foco; demais no alerta;
  - rotas `projects` e `projects/new` na área `/o/:slug`; link "Projetos" na navegação; textos em `projects.messages.ts`.
- **Testes** (web: 245, sendo 19 novos): sugestão e normalização da chave; lista (links por chave, papel, botão por capacidade, filtro de arquivados, paginação sem duplicar, erro e nova tentativa); criação (sugestão, envio, navegação para `/o/acme/projects/PDC`, chave editada, `PROJECT_KEY_TAKEN` no campo com foco, validação local, `INSUFFICIENT_ROLE` no alerta).
- **Ajuste**: a navegação para a área do projeto é verificada pelo pedido ao router, porque a rota `projects/:key` nasce na T12.
- **Mutation testing**, 4/4 detectados:
  - botão sempre visível; sem sugestão de chave; chave sem normalização;
  - "Carregar mais" sem guarda: **sobreviveu na primeira rodada**. O teste confiava em `HttpTestingController.verify()` depois de `match()`, mas o `match` remove da fila todas as requisições que casam. Agora o teste conta as requisições.
- **Comandos**: `nx run-many -t lint typecheck test -p web` ✔ (245).

### T12 — 2026-10-13

- **Entregue** (`apps/web/src/app/features/projects`):
  - rota `/o/:slug/projects/:key` com `RECREATE_ON_PARAM_CHANGE` e as filhas `''` (visão geral), `members` e `settings`;
  - `ActiveProjectStore`, provido no `ProjectLayout`:
    - `can(permission)` sobre as capacidades da API (já descontado o arquivamento);
    - `reload()` **silencioso** com o projeto carregado (as páginas filhas não são desmontadas);
    - qualquer 404 `PROJECT_NOT_FOUND` leva à lista com aviso (`PROJECT_NOT_FOUND_STATE`);
  - `ProjectLayout`: skeleton, erro com nova tentativa, cabeçalho com chave e estado arquivado, navegação por seções;
  - `ProjectOverviewPage`: descrição em várias linhas, papel e o workflow só leitura (status e transições);
  - `ProjectSettingsPage`: formulário editável só com `project:update` (`effect` reage a recargas e capacidades); arquivar com confirmação e restaurar; `VERSION_CONFLICT` e `PROJECT_ARCHIVED` recarregam e explicam;
  - `ProjectMembersPage` + `ProjectMembersStore`: papéis e remoção só pelas `actions`; adicionar a partir de candidatos com os papéis de `allowedRoles`; sair leva à lista; mudar o próprio papel recarrega projeto e lista; "Carregar mais" uma página por vez.
- **Desvio do design, registrado aqui**: o projeto é carregado pelo componente de layout, não por um resolver. A área precisa do `ActiveOrganizationStore`, que vive no componente pai e não fica disponível a resolvers, e ganha estados próprios de carregamento e erro.
- **Testes** (web: 259, sendo 14 novos):
  - área: carregamento por chave com workflow, arquivado, 404 ⇒ lista com aviso, erro com nova tentativa;
  - configurações: edição com versão; somente leitura sem capacidade; arquivar com confirmação e restaurar; conflito recarrega sem desmontar a página;
  - participantes: opções e remoção só pelas `actions`; adicionar com teto (`viewer` ⇒ só viewer); recusa da API explicada; sair volta à lista; arquivado sem seção de adicionar; mudar o próprio papel recarrega capacidades.
- **Mutation testing**, 7/7 detectados: `can()` sempre verdadeiro; papéis fora das `actions`; 404 sem tratamento; recarga com skeleton; adicionar sem capacidade; sair sem navegar (refeito: a primeira versão do mutante não compilava); sem recarga depois de mudar o próprio papel.
- **Comandos**: `nx run-many -t lint typecheck test -p web` ✔ (259); `nx affected -t lint typecheck test` ✔.

### T13 — 2026-10-13

- **Entregue** (`apps/web-e2e`):
  - `support/accounts.ts`: cadastro, confirmação pelo Mailpit, onboarding e convite/aceite, compartilhados (a jornada da spec 002 passou a usá-lo);
  - `projects-journey.spec.ts` (CA-10), jornada real sem simulação:
    - owner e membro convidado;
    - o membro sem participação não vê projetos;
    - o owner cria "Portal do Cliente", com a chave `PDC` sugerida, e vê o workflow;
    - adiciona o membro como participante, e o membro passa a ver e abrir o projeto;
    - arquiva (some da lista padrão e aparece em "Arquivados") e restaura.
- **Bug encontrado pela jornada e corrigido**: o foco no botão de confirmação (arquivar, remover ou sair) falhava com `TypeError: Cannot read properties of undefined (reading 'focus')`. Com `#confirmButton` num `mat-flat-button`, o `viewChild` devolve o componente, não o elemento. A correção é `viewChild('confirmButton', { read: ElementRef })`, como em `members-list.ts`. Os testes de componente não pegavam isso; agora afirmam que a confirmação recebe o foco, e o mutante com o código antigo morre.
- **Falha do próprio teste, corrigida**: "Configurações" existe nas navegações da organização e do projeto. A jornada agora usa a navegação "Seções do projeto" e espera a URL do projeto antes de clicar.
- `docs/development/testing.md`: a suíte completa faz **5 cadastros**, exatamente o limite por IP.
- **Comandos**: Playwright ✔ **19/19** (banco `taskflow_e2e` sem migrations pendentes, Redis índice 2, só chaves `rate-limit:auth.*` apagadas); `nx run-many -t lint typecheck test -p web web-e2e` ✔ (259).

### T14 — 2026-10-13

- **Entregue**:
  - ADR 0015 **aceito** com a spec (índice atualizado), com as duas exceções da 003;
  - `bounded-contexts.md`: `projects` e `organizations` implementados; seta pontilhada síncrona `ORG → PRJ`; decisão de fronteira `projects × organizations` (portas, ordem de locks); tabela de exceções do ADR 0015;
  - `dependency-rules.md`: bibliotecas de `projects`; novos casos de uso e porta de `organizations`; lint `organizationsMustNotReachProjects`; o que entrou em `shared/*` (`toPageRequest`, `noStore`, `isForeignKeyViolation`); `mergeDomainErrors`;
  - `business-rules.md`: BR-025, BR-026 e BR-027; estado da BR-004 (workflow padrão); BR-003 (remover nunca é bloqueado por tarefas);
  - `authorization.md`: permissões de projeto aplicadas; D1; capacidades e ações de projeto; 404 idêntico e 403 antes de erros de estado;
  - `multi-tenancy.md`: harness ampliado (schemas obrigatórios, código conferido, ator duplo, `noStore` por identidade) e bateria intra-tenant;
  - `testing.md`: linha da spec 003 e contagem de cadastros do E2E;
  - roadmap: 003 em validação final;
  - `.claude/rules/database.md` e cabeçalhos do Prisma: atualizados na T2.
- **Verificação**: script de links em `docs/**` e `specs/003-projects/**` — 0 quebrados pela spec (o único, `NNNN-titulo.md`, é o placeholder do template de ADR, anterior a esta spec); os 6 caminhos de código citados existem; `prettier --check` ✔.

### T15 — 2026-10-13

- **`/review-code`**: veredito "pronto", sem bloqueantes nem importantes. Sugestões aplicadas:
  - quem não participa (owner/admin) "saindo" recebe 404 `PROJECT_MEMBER_NOT_FOUND`, não 403 (sair agora exige só ver o projeto; a permissão sintética `participant` foi removida do auxiliar de lock);
  - `by-key` valida o formato da BR-025 na rota (malformada ⇒ 404 sem chegar ao caso de uso, com teste);
  - 422 `ALREADY_MANAGES_ALL_PROJECTS` documentado no PATCH de participante (OpenAPI e design);
  - `isArchived` não considera arquivado um projeto ainda não carregado;
  - cabeçalho do design em "revisão 3".
  - Não aplicadas, com motivo:
    - conta buscada depois do commit: mesmo padrão aceito no `ChangeMemberRole` da spec 002; degradar em silêncio contrariaria "sem erros engolidos";
    - `version + 1` calculado pelo caso de uso: convenção dos repositórios de `organizations`; mudar só aqui criaria duas convenções.
- **`/security-audit`**: sem Críticos, Altos ou Médios. Dois achados Baixos, corrigidos:
  - `PATCH /projects/{id}` ganhou o limite `projects.update.user` (120/h), com teste de 429 e OpenAPI atualizado;
  - `createRateLimit` ganhou `requireKey`: chave ausente vira erro (500) em vez de pular o limite em silêncio. Os limites de `projects` o usam; o comportamento de identidade não muda. Há teste em `shared/http`.
- **Mutation testing** das correções, 2/2 detectados: `requireKey` ignorado; edição sem limite.
- **Gate final**:
  - `pnpm verify` ✔ (código 0): 66/66 tarefas, lint, typecheck, test e build (63 vindas do cache do Nx, com entradas inalteradas);
  - `pnpm test:integration --skip-nx-cache` ✔: 6 projetos, **154 testes** (shared 28, identity 50, organizations 32, projects 17, worker 9, api 18);
  - Playwright ✔ **19/19** (banco `taskflow_e2e` sem migrations pendentes, Redis índice 2).
