# Regras de dependência

As regras abaixo são **verificadas automaticamente** por `@nx/enforce-module-boundaries` em `eslint.config.mjs` — rodam em `pnpm lint` e no CI. Documentação e lint devem sempre coincidir; ao mudar um, mude o outro.

## Dimensões de tags

Todo projeto Nx recebe três dimensões de tags:

| Dimensão   | Valores                                                                                                                                 | Significado                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `scope:*`  | `frontend`, `backend`, `shared`                                                                                                         | Em que runtime o código roda.           |
| `domain:*` | `shared`, `identity`, `organizations`, `projects`, `tasks`, `boards`, `sprints`, `collaboration`, `notifications`, `analytics`, `audit` | Bounded context. Apps não têm `domain`. |
| `type:*`   | `app`, `contracts`, `domain`, `application`, `infrastructure`, `presentation`, `feature`, `ui`, `data-access`, `util`, `model`, `e2e`   | Camada/papel.                           |

## Restrições por escopo

| Origem           | Pode depender de                 |
| ---------------- | -------------------------------- |
| `scope:frontend` | `scope:frontend`, `scope:shared` |
| `scope:backend`  | `scope:backend`, `scope:shared`  |
| `scope:shared`   | `scope:shared`                   |

## Restrições por contexto

| Origem          | Pode depender de              |
| --------------- | ----------------------------- |
| `domain:<x>`    | `domain:<x>`, `domain:shared` |
| `domain:shared` | `domain:shared`               |

Consequência: **nenhum contexto importa outro**. Integração entre contextos acontece por portas definidas na `application` do consumidor e adaptadores ligados no composition root (`apps/api`), que não possui tag `domain`.

## Restrições por tipo (backend)

```mermaid
flowchart LR
    app[type:app] --> presentation[type:presentation]
    app --> infrastructure[type:infrastructure]
    app --> application[type:application]
    app --> contracts[type:contracts]
    presentation --> application
    presentation --> domain[type:domain]
    presentation --> contracts
    infrastructure --> application
    infrastructure --> domain
    application --> domain
```

| Origem                | Pode depender de                                                         | Importações externas proibidas                                                                                              |
| --------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `type:domain`         | `type:domain`                                                            | **todos** os pacotes npm (`allowedExternalImports: []`) — domínio é TypeScript puro; capacidades externas entram por portas |
| `type:application`    | `type:domain`, `type:application`                                        | `express`, `@prisma/*`, `prisma`, `ioredis`, `bullmq`, `socket.io`, `pino`, `pino-http`, `@angular/*`                       |
| `type:infrastructure` | `type:domain`, `type:application`, `type:infrastructure`                 | `express`, `@angular/*`                                                                                                     |
| `type:presentation`   | `type:application`, `type:domain`, `type:contracts`, `type:presentation` | `@prisma/*`, `prisma`, `ioredis`, `bullmq`, `@angular/*` — middlewares recebem portas, nunca falam com Redis/filas          |
| `type:contracts`      | `type:contracts`                                                         | tudo exceto `zod` (`allowedExternalImports`)                                                                                |

O Nx verifica apenas pacotes presentes no grafo (instalados); módulos nativos do Node (`node:*`) não são verificados — seu uso em `domain` é barrado na revisão de código.

`presentation → domain` é permitido apenas para mapear erros e tipos de valor na resposta; controllers não chamam métodos de entidades.

## Bibliotecas compartilhadas do backend (implementadas)

Todas com `scope:backend` e `domain:shared` — qualquer contexto pode usá-las, respeitando a camada.

| Projeto                              | `type:*`         | Import                                            | Conteúdo                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------ | ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/shared/kernel`         | `domain`         | `@taskflow/backend/shared/kernel`                 | `DomainError`, `Clock`, `IdGenerator`, `EmailAddress`, `normalizeDisplayText`, `OrganizationRole`; autorização (spec 006, [ADR 0013](adr/0013-authorization-shared-kernel.md)): catálogos de permissões, `PROJECT_ROLES`, guardas, matrizes, `organizationPermissions`, `hasOrganizationPermission`, `effectiveProjectRole`, `canOnProject` — só dados e funções puras                                                                                                                |
| `libs/backend/shared/application`    | `application`    | `@taskflow/backend/shared/application`            | `RequestContext`, `TenantRequestContext`, `TransactionRunner`, `IntegrationEvent`/`createIntegrationEvent`, `OutboxWriter`, `EmailSender`, `RateLimiter`, `SecurityEventRecorder` genérico; subcaminho `/testing` com fakes genéricos                                                                                                                                                                                                                                                 |
| `libs/backend/shared/http`           | `presentation`   | `@taskflow/backend/shared/http`                   | `HttpError`, error handler (`DomainError` → Problem Details), `parseBody`, `createAuthenticate`, `createCsrfProtection`, `createRateLimit`, `clientIpKey`, `createTenantContext`/`tenantRequestContextFrom`, `createTenantScope` (ADR 0012), serializers de log                                                                                                                                                                                                                       |
| `libs/backend/shared/infrastructure` | `infrastructure` | `@taskflow/backend/shared/infrastructure`         | Prisma (cliente, `PrismaTransactionRunner`, `PrismaOutboxWriter`, `PrismaOutboxRetention`, `isUniqueConstraintViolation`, tipos `*Row`), Redis (cliente, `RedisRateLimiter`), BullMQ (`createEventQueue`, `createEventWorker`, `BullMqEventPublisher`, `OutboxRelay`), `SmtpEmailSender`, layout de e-mail (`renderEmail`, `escapeHtml`), `createLogger`, base de configuração (`parseEnvironment`), `checkReadiness` e probes, `UuidV7Generator`, `SystemClock`, `HmacPseudonymizer` |
| ↳ subcaminho de testes               | —                | `@taskflow/backend/shared/infrastructure/testing` | `startPostgresTestDatabase()` (PostgreSQL efêmero + migrations reais). **Somente em testes**; excluído do `tsconfig.lib.json`                                                                                                                                                                                                                                                                                                                                                         |

Regra de inclusão: algo só entra em `shared/*` quando dois ou mais contextos já precisam dele (ou a spec que o cria demonstra o segundo uso, como `RequestContext` para a spec 002). Na spec 002 entraram por esse critério o layout de e-mail (`renderEmail`), os fakes genéricos de teste e o `SecurityEventRecorder` genérico; na spec 006, o vocabulário de autorização (usado por `organizations` e, pelas obrigações registradas, por `projects`, `tasks` e `boards`). Regras que dependem de estado não entram no kernel. O catálogo de permissões é espelhado em `libs/contracts` (o kernel não importa contracts) e protegido por teste de paridade.

**Escopo do tenant e isolamento** (spec 006): ler `params.organizationId` fora de `libs/backend/shared/http/src/lib/tenant/tenant-context.ts` é barrado pelo lint (`no-restricted-syntax` em `eslint.config.mjs`). Todo router tenant-scoped é montado pelo composition root dentro de `createTenantScope` e precisa de um caso em `apps/api/src/testing/isolation-cases.ts`; rotas fora do escopo precisam de justificativa em `GLOBAL_ROUTES`. O teste `apps/api/src/modules/route-coverage.spec.ts` falha se faltar um dos dois. `apps/api/src/testing` só existe em testes (excluído de `tsconfig.app.json`).

## Bibliotecas do contexto Identity & Access (implementadas, spec 001)

Todas com `scope:backend` e `domain:identity`. Nenhum outro contexto as importa; outros contextos consultam a identidade por portas próprias ligadas no composition root (ex.: a porta `UserDirectory` de `organizations`, ligada em `apps/api` e `apps/worker` a `GetUserAccountsUseCase` e `FindUserIdByEmailUseCase`).

| Projeto                                | Tipo             | Alias                                       | Conteúdo                                                                                                                                      |
| -------------------------------------- | ---------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/identity/domain`         | `domain`         | `@taskflow/backend/identity/domain`         | `User`, `Session`, `UserToken`, `Password` (BR-011), `PersonName`, contratos de repositório, `SecretTokenGenerator`, `PasswordHasher`         |
| `libs/backend/identity/application`    | `application`    | `@taskflow/backend/identity/application`    | Casos de uso (cadastro, login, refresh, logout, sessões, verificação, recuperação, envios do worker, retenção), portas, políticas de limite   |
| `libs/backend/identity/infrastructure` | `infrastructure` | `@taskflow/backend/identity/infrastructure` | Repositórios Prisma, Argon2id, `JoseAccessTokens`, lista de revogação e rastreador de login no Redis, lista de senhas comuns, templates pt-BR |
| `libs/backend/identity/http`           | `presentation`   | `@taskflow/backend/identity/http`           | `createIdentityRouter`, cookies de sessão, mapeamento de erros, limites por endpoint, OpenAPI                                                 |

Subcaminhos de teste (fora do build): `@taskflow/backend/identity/application/testing` (fakes em memória) e `@taskflow/backend/shared/infrastructure/testing` (PostgreSQL efêmero).

## Bibliotecas do contexto Organizations (implementadas, spec 002)

Todas com `scope:backend` e `domain:organizations`. Não importam `identity` (verificado pelo lint de boundaries); contas de usuário chegam pela porta `UserDirectory`.

| Projeto                                     | Tipo             | Alias                                            | Conteúdo                                                                                                                                                               |
| ------------------------------------------- | ---------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/organizations/domain`         | `domain`         | `@taskflow/backend/organizations/domain`         | `Organization`, `OrganizationName`, `OrganizationSlug` (BR-022), `Membership`, `Invitation` (BR-020), política de papéis (BR-021), contratos de repositório            |
| `libs/backend/organizations/application`    | `application`    | `@taskflow/backend/organizations/application`    | Casos de uso (organização, membros com lock e releitura, convites, aceite, envio pelo worker, retenção), portas `UserDirectory`, `InvitationTokenGenerator`, templates |
| `libs/backend/organizations/infrastructure` | `infrastructure` | `@taskflow/backend/organizations/infrastructure` | Repositórios Prisma (lock `FOR NO KEY UPDATE`, filtro por organização em leitura e escrita, cursor keyset), retenção em lotes, template pt-BR do convite               |
| `libs/backend/organizations/http`           | `presentation`   | `@taskflow/backend/organizations/http`           | `createOrganizationsRouters` (router fora do tenant + router tenant-scoped relativo), mapeamento de erros, limites, OpenAPI                                            |

Subcaminho de teste: `@taskflow/backend/organizations/application/testing` (fakes em memória e testbed).

Desde a spec 003, a aplicação de `organizations` também expõe `LockOrganizationForShare`, `GetMemberRoles` e `ListMembersExcluding` (servem à porta `OrganizationAccess` de `projects`) e chama a porta `MembershipRoleChanges` em `ChangeMemberRole`. O lint `organizationsMustNotReachProjects` (exportado por `eslint.config.mjs` e incluído nos configs das bibliotecas de `organizations`) barra a back-relation do ADR 0015 e os modelos de `projects`.

## Bibliotecas do contexto Projects (implementadas, spec 003)

Todas com `scope:backend` e `domain:projects`. Não importam `organizations` nem `identity`: papéis, configuração e contas chegam pelas portas `OrganizationAccess` e `UserDirectory`, ligadas em `apps/api/src/modules/adapters`.

| Projeto                                | Tipo             | Alias                                       | Conteúdo                                                                                                                                                                                |
| -------------------------------------- | ---------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/projects/domain`         | `domain`         | `@taskflow/backend/projects/domain`         | `Project`, `ProjectKey` (BR-025), `ProjectName`, descrição, `ProjectMember` com teto (BR-027), `projectCapabilities`, `participantActions`, `defaultWorkflow`, contratos de repositório |
| `libs/backend/projects/application`    | `application`    | `@taskflow/backend/projects/application`    | Casos de uso (projetos e participantes, com lock da organização e do projeto e ordem de decisão fixa), `ApplyOrganizationRoleChange`, portas, limites, eventos `projects.*`             |
| `libs/backend/projects/infrastructure` | `infrastructure` | `@taskflow/backend/projects/infrastructure` | Repositórios Prisma (visibilidade na mesma consulta, lock `FOR NO KEY UPDATE`, keyset, `P2002`/`P2003` traduzidos)                                                                      |
| `libs/backend/projects/http`           | `presentation`   | `@taskflow/backend/projects/http`           | `createProjectsRouter` (só rotas tenant-scoped relativas), mapeamento de erros, limites, OpenAPI                                                                                        |

Subcaminho de teste: `@taskflow/backend/projects/application/testing` (fakes em memória e testbed).

Na spec 003 entraram em `shared/*`, por terem dois contextos usuários: `toPageRequest` e os tetos de paginação (`shared/application`), `noStore` (`shared/http`, reconhecido por identidade pelo harness) e `isForeignKeyViolation` (`shared/infrastructure`). `apps/api` junta os mapas de erro com `mergeDomainErrors`, que falha na montagem se dois contextos mapearem o mesmo código de formas diferentes.

## Bibliotecas do contexto Tasks (implementadas, spec 004)

Todas com `scope:backend` e `domain:tasks`. Não importam `projects`, `organizations` nem `identity`: papéis efetivos, workflow e nomes chegam pelas portas `ProjectAccess` e `TaskUserDirectory`, ligadas em `apps/api/src/modules/adapters` (`project-access.adapter.ts`, `task-user-directory.adapter.ts`).

| Projeto                             | Tipo             | Alias                                    | Conteúdo                                                                                                                                                                                                                         |
| ----------------------------------- | ---------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/tasks/domain`         | `domain`         | `@taskflow/backend/tasks/domain`         | `Task`, `TaskTitle`, descrição, `Priority`, prazo, chave `CHAVE-N` (BR-028), BR-029, workflow (`assertTransitionAllowed`, BR-004), grafo com aresta implícita e tetos (BR-006, D4), `taskActions` (D5), contratos de repositório |
| `libs/backend/tasks/application`    | `application`    | `@taskflow/backend/tasks/application`    | Casos de uso com núcleo `…WithinTransaction` e casca (eventos depois do commit), `lockTaskForWrite` (ordem de decisão e de locks), `RevokeAssignmentsOnAccessLoss`, portas, limites, eventos `tasks.*`                           |
| `libs/backend/tasks/infrastructure` | `infrastructure` | `@taskflow/backend/tasks/infrastructure` | Repositórios Prisma (sempre `organizationId` e `projectId`; contador por `upsert`; `task_project_locks`; keyset por número; `P2002`/`P2003` traduzidos)                                                                          |
| `libs/backend/tasks/http`           | `presentation`   | `@taskflow/backend/tasks/http`           | `createTasksRouter` (rotas literais antes de `/:taskId`), mapeamento de erros (com a extensão `taskIds`), OpenAPI                                                                                                                |

Subcaminho de teste: `@taskflow/backend/tasks/application/testing` (fakes, `FakeProjectAccess` e o cenário `createTasksWorld`).

Para servir `tasks`, `projects/application` expõe `LockProjectForContribution`, `ResolveProjectForRead` e `ListAssignableUsers` (em `createProjectsModule().contribution`) e chama a porta `ProjectContributorChanges`; `organizations/application` expõe `LockMembersForShare`. Lints: `projectsMustNotReachTasks` (back-relations inertes `tasks`, `taskCounter`, `taskProjectLock`), `organizationsMustNotReachProjects` ampliado (`assignedTasks`) e `tasksMustNotReachOtherContexts`, que também vale na aplicação (por isso o resultado do núcleo usa `projectContext`). Os três ignoram `*.integration.spec.ts`, que semeiam tabelas de outros contextos de propósito.

Na spec 004 entraram em `shared/*`: `ConcurrentUpdateError` e a opção `TransactionOptions.lockTimeoutMs` da porta `TransactionRunner` (`shared/application`, 409 `CONCURRENT_UPDATE`), `isTransactionConflict`, `isLockTimeout` e o `PrismaTransactionRunner` com READ COMMITTED explícito, uma nova tentativa em `P2034` e `lock_timeout` por transação (`shared/infrastructure`), e o membro de extensão `taskIds` do Problem Details (`DomainErrorMapping.taskIds` em `shared/http`, `problemDetailsSchema` em `libs/contracts`).

## Restrições por tipo (frontend)

| Origem             | Pode depender de                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `type:app` (web)   | qualquer biblioteca `scope:frontend`/`scope:shared`                                         |
| `type:feature`     | `type:feature`*, `type:ui`, `type:data-access`, `type:util`, `type:model`, `type:contracts` |
| `type:ui`          | `type:ui`, `type:util`, `type:model`                                                        |
| `type:data-access` | `type:data-access`, `type:util`, `type:model`, `type:contracts`                             |
| `type:util`        | `type:util`                                                                                 |
| `type:model`       | `type:model`, `type:contracts`                                                              |

\* Somente via rotas lazy (`loadChildren`), nunca importação direta de componentes de outra feature.

## Regras adicionais (lint e revisão)

- Importar apenas o `index.ts` público de outro projeto (`@nx/enforce-module-boundaries` rejeita deep imports).
- Sem dependências circulares entre projetos (verificado pelo mesmo rule).
- Regras de camada **dentro** de um projeto (ex.: `apps/api/src`) são garantidas por revisão (`/review-code`) — por isso o código de negócio vive em bibliotecas, não nos apps.

## Como verificar

```bash
pnpm lint                 # inclui enforce-module-boundaries
pnpm nx graph             # visualiza o grafo de projetos
```
