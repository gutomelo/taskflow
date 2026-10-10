# 002 — Organizações e multi-tenancy · Tarefas

Regras: uma tarefa por execução de `/implement-spec`; marcar `[x]` somente com evidência executada (seção abaixo). Toda tarefa termina com `pnpm nx affected -t lint typecheck test` passando; tarefas com persistência ou worker também com `pnpm test:integration`. Toda feature tenant-scoped tem teste de isolamento A/B (RNF-01).

## Bloco A — Fundações compartilhadas e domínio

| ID  | Tarefa                                                                                                                                                          | Depende de | Verificação                                                                                                    | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------- | ------ |
| T1  | `shared/application`: `OrganizationRole`, `TenantRequestContext`; mover `SecurityEventRecorder` de `identity/application` (identity passa a importar de shared) | —          | typecheck; testes de identity verdes; lint de boundaries                                                       | [x]    |
| T2  | `shared/kernel`: validação de texto exibível (sem controles, CR/LF, bidi, zero-width); aplicar em `PersonName` (identity)                                       | —          | testes por categoria de caractere; cadastro recusa nome malicioso (400)                                        | [x]    |
| T3  | `shared/http`: `createTenantContext({ resolve })` (UUID inválido ⇒ 404, sem `actor` ⇒ 401, papel por enum) e `tenantRequestContextFrom` (falha fechado)         | T1         | Supertest: UUID inválido/sem membership/inexistente ⇒ 404 idêntico; sem actor ⇒ 401; papel desconhecido negado | [x]    |
| T4  | Gerar `libs/backend/organizations/{domain,application,infrastructure,http}` com tags `scope:backend`, `domain:organizations`, `type:*` e aliases                | —          | `nx show projects`; lint de boundaries (import proibido falha)                                                 | [x]    |
| T5  | Domínio: `OrganizationName`, `OrganizationSlug` (BR-022), `Organization`, `Membership`, `Invitation`, política de papéis (BR-021); repositórios (interfaces)    | T2, T4     | testes de domínio nomeados por BR (slug reservado/formato; matriz de papéis tabela-driven)                     | [x]    |

## Bloco B — Persistência

| ID  | Tarefa                                                                                                                                                                                                  | Depende de | Verificação                                                                                                                                       | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T6  | `prisma/models/organizations.prisma` + migration: `CHECK` de slug, papel do convite ≠ owner, aceite × revogação; único parcial de convite aberto; índices (incluindo a exceção `(user_id)` documentada) | T5         | SQL revisado; integração: constraints rejeitam dados inválidos                                                                                    | [x]    |
| T7  | Repositórios Prisma: `lockOrganization` (`FOR NO KEY UPDATE`, sem tocar `version`), memberships e convites com `organizationId` em leitura **e** escrita, paginação por cursor, `BR-008` por versão     | T6         | integração: lock serializa duas transações; escrita com `organizationId` de B não altera nada; cursor estável; P2002 do convite duplicado tratado | [x]    |

## Bloco C — Aplicação

| ID  | Tarefa                                                                                                                                                                                                                 | Depende de | Verificação                                                                                                                                             | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T8  | `identity`: `GetUserAccountsUseCase` (ids → nome, e-mail, verificado) e `FindUserIdByEmailUseCase`; porta `UserDirectory` em `organizations/application`; fakes de teste                                               | T4         | testes de casos de uso; nada de `identity` importado por `organizations`                                                                                | [x]    |
| T9  | Casos de uso: `CreateOrganization` (BR-013, limites, teto de 20 como owner), `ListMyOrganizations`, `GetOrganization`, `RenameOrganization`, `ResolveTenantMembership`                                                 | T5, T8     | fakes: CA-01, CA-02; BR-013 nomeado                                                                                                                     | [x]    |
| T10 | Membros: `ListMembers` (página; nome, e-mail, papel), `ChangeMemberRole`, `RemoveMember` (inclui sair; revoga convites abertos do removido/rebaixado) — lock, releitura de ator e alvo, BR-019/BR-021                  | T9         | fakes: matriz de papéis e último owner (CA-07, CA-08); **integração concorrente**: dois owners se rebaixando; ator rebaixado no meio não promove/remove | [x]    |
| T11 | Convites: `InviteMember` (reconvite atualiza papel; limites por destinatário, conta, organização e (organização, e-mail)), `ListInvitations`, `ResendInvitation`, `RevokeInvitation` — eventos com `delivery_event_id` | T9         | fakes: CA-06, CA-12; resposta idêntica para e-mail com/sem conta                                                                                        | [x]    |
| T12 | `LookupInvitation` (e-mail mascarado) e `AcceptInvitation` (ordem `EMAIL_NOT_VERIFIED` → conta errada → inválido; revalida convidante; consumo condicionado ao e-mail; teto de memberships)                            | T10, T11   | fakes: CA-04, CA-05; integração: aceite × revogação concorrentes ⇒ um vence                                                                             | [x]    |

## Bloco D — HTTP e composição

| ID  | Tarefa                                                                                                                                                                                                                                                    | Depende de | Verificação                                                                                           | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- | ------ |
| T13 | Contratos (`libs/contracts`), router de `organizations` (rotas do tenant e fora dele), mapeamento de erros, limites; `createOrganizationsModule`; router do tenant único no composition root (`mergeParams`), ordem `authenticate → csrf → tenantContext` | T3, T12    | Supertest dos endpoints; teste que percorre a tabela de rotas (toda rota tenant-scoped sob o prefixo) | [x]    |
| T14 | Isolamento A/B (RNF-01): todo endpoint sob o prefixo com ids **reais** da organização B; PATCH/DELETE de membro e resend/revoke de convite ⇒ 404 e banco inalterado                                                                                       | T13        | integração com PostgreSQL (CA-03, CA-09)                                                              | [x]    |
| T15 | OpenAPI dos endpoints novos                                                                                                                                                                                                                               | T13        | documento válido; todas as rotas descritas                                                            | [x]    |

## Bloco E — Worker

| ID  | Tarefa                                                                                                                                                                                                                            | Depende de | Verificação                                                                                                                       | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T16 | `SendInvitation` (emissão condicional a `delivery_event_id`) + template pt-BR (frase fixa, nome entre aspas, aviso) + mapeamento na fila `emails`; adaptador `UserDirectory` no worker; limite por destinatário aplicado no envio | T11        | integração com Mailpit: convite entregue; reenvio invalida o link anterior; evento antigo fora de ordem descartado (CA-04, CA-06) | [x]    |
| T17 | Retenção: convites encerrados (aceitos, revogados, expirados) apagados após 30 dias no job diário                                                                                                                                 | T6         | integração da limpeza                                                                                                             | [x]    |

## Bloco F — Frontend

| ID  | Tarefa                                                                                                                                                                                                                          | Depende de   | Verificação                                             | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------- | ------ |
| T18 | `ActiveOrganizationStore` (slug → id, recarga única, 404 ⇒ `/organizations`), data-access com URLs pelo id, stores da organização providos em `/o/:slug`; home `/` redireciona; `localStorage { userId, slug }` limpo no logout | T13          | testes de store e redirecionamento (CA-10)              | [x]    |
| T19 | Onboarding `/organizations/new` (nome → slug sugerido, erros por `code`), `/organizations` e seletor no cabeçalho                                                                                                               | T18          | testes de formulário e componente (CA-01, CA-02, CA-10) | [x]    |
| T20 | Membros e convites `/o/:slug/members` e configurações `/o/:slug/settings`: lista paginada, alterar papel, remover, sair, convidar, reenviar, revogar (ações conforme papel; confirmação)                                        | T18          | testes de componente (CA-07, CA-08)                     | [x]    |
| T21 | Aceite `/invitations/accept`: token do fragmento só em memória, entrar/cadastrar, `lookup`, aceite por clique, orientação para reabrir o link                                                                                   | T18          | testes de componente (CA-04, CA-05)                     | [x]    |
| T22 | E2E: jornada CA-11 com Mailpit (banco descartável); E2E de isolamento pela UI (URL de outra organização ⇒ não encontrada)                                                                                                       | T16, T19–T21 | `pnpm e2e`                                              | [x]    |

## Bloco G — Fechamento

| ID  | Tarefa                                                                                                                                                                                                                                                                             | Depende de | Verificação                                                              | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ | ------ |
| T23 | `/review-code` e `/security-audit` do conjunto; correções                                                                                                                                                                                                                          | T1–T22     | sem bloqueantes / sem Críticos-Altos abertos                             | [x]    |
| T24 | Docs: BR-019…BR-022 e desvio da BR-007 em `business-rules.md`; `multi-tenancy.md` e `authorization.md` (prefixo, sem `status`, visibilidade de e-mails); `.claude/rules/api-design.md` e `security.md`; ADR 0012 → Aceito; roadmap (equipes adiadas); índice de specs; arquitetura | T23        | verificação de links; `pnpm verify`, `pnpm test:integration`, `pnpm e2e` | [x]    |

## Evidências

### T1 — 2026-10-09

- **Entregue**: `shared/application` com `ORGANIZATION_ROLES`, `OrganizationRole`, `isOrganizationRole` (papel desconhecido nunca concede permissão), `Tenant` e `TenantRequestContext`; porta genérica `SecurityEventRecorder<TEvent>` (+ `SecurityEventBase`). A `identity` mantém a união `SecurityEvent` e exporta `SecurityEventRecorder` como alias da porta compartilhada (nenhum consumidor mudou).
- **Testes**: `tenant-request-context.spec.ts` (4 papéis aceitos, 7 valores recusados). Mutação "qualquer string é papel" ⇒ falhas detectadas.
- **Comandos**: `nx run-many -t lint typecheck test` (shared/application, identity ×3, api) ✔.

### T2 — 2026-10-09

- **Entregue**: `normalizeDisplayText` no kernel — NFC, bordas aparadas, espaços internos (inclusive quebras de linha) reduzidos a um, tamanho em code points; recusa controles (Cc), formatação invisível — bidi, zero-width — (Cf), uso privado (Co), não atribuídos (Cn) e surrogates soltos (Cs). `PersonName` passou a usá-la (antes recusava Cc e Cf; agora também Co, Cn e Cs).
- **Testes**: `display-text.spec.ts` (normalização, limites em code points, 7 categorias recusadas, BOM vira espaço comum); HTTP: cadastro com override bidi no nome ⇒ 400 `INVALID_PERSON_NAME`.
- **Correções durante a tarefa**:
  - o BOM (U+FEFF) é tratado como espaço pelo JavaScript (`trim()` e `\s`), então vira espaço visível — comportamento seguro; o teste que exigia recusa estava errado e passou a afirmar a normalização;
  - os casos do teste tinham ficado com caracteres invisíveis literais no código; foram reescritos com `String.fromCodePoint` e códigos explícitos;
  - uma checagem por script marcou a T2 como concluída com um teste ainda vermelho; a marcação foi desfeita e só refeita com o gate verde.
- **Mutação**: aceitar tudo exceto controles ⇒ falhas detectadas.
- **Comandos**: `nx run-many -t lint typecheck test` (shared/kernel, identity domain e http) ✔.

### T3 — 2026-10-09

- **Entregue** (`shared/http/src/lib/tenant`): `createTenantContext({ resolve })` — exige sessão (401 antes de qualquer consulta), valida o UUID de `:organizationId` antes do banco, normaliza para minúsculas, chama o resolvedor injetado e valida o papel pelo enum; sem membership, organização inexistente, id malformado e papel desconhecido dão o **mesmo** 404 `ORGANIZATION_NOT_FOUND` (papel desconhecido também gera log de erro). `tenantRequestContextFrom` falha fechado (500 genérico) em rota sem o middleware. Augment `Request.tenant`.
- **Testes** (`tenant-context.spec.ts`, 5, com o router montado no prefixo e `mergeParams`, como no composition root): contexto válido e argumentos do resolvedor; id em maiúsculas normalizado; 401 sem sessão sem consultar; 404 idêntico para outro tenant, id malformado (não consulta) e papel desconhecido; rota fora do prefixo ⇒ 500.
- **Mutation testing**, 4/4 detectadas: sem validar UUID; papel desconhecido aceito; tenant montado a partir da URL; sem exigir sessão.
- **Comandos**: `nx run-many -t lint typecheck test -p backend-shared-http` ✔ (43).

### T4 — 2026-10-09

- **Entregue**: `libs/backend/organizations/domain` (`backend-organizations-domain`, tags `scope:backend`, `domain:organizations`, `type:domain`; alias `@taskflow/backend/organizations/domain`), com a mesma configuração das bibliotecas de identity.
- **Desvio de execução (regra de arquitetura)**: só a biblioteca de domínio foi criada agora. `application`, `infrastructure` e `http` nascem nas tarefas que lhes dão código (T8/T9, T7, T13): a regra proíbe bibliotecas vazias "para depois".
- **Verificação**: import de `@taskflow/backend/identity/domain` e de `express` no domínio novo ⇒ 2 erros de `@nx/enforce-module-boundaries` (arquivo temporário removido).

### T5 — 2026-10-09

- **Entregue** (domínio puro):
  - value objects `OrganizationName` (texto exibível do kernel, 2–80) e `OrganizationSlug` (BR-022: 3–40, formato, reservados contra impersonação, sem normalização);
  - entidades `Organization` (slug imutável, nome editável, versão), `Membership` (papel, versão) e `Invitation` (nunca `owner`, 7 dias, `deliveryEventId`, reenvio que renova o prazo e pode mudar o papel, revogação idempotente);
  - política de papéis BR-021 como funções puras (`canManageMembers`, `canInvite`, `canChangeRole`, `canRemove`);
  - erros (`INVALID_ORGANIZATION_NAME`, `INVALID_SLUG`, `SLUG_TAKEN`, `ALREADY_A_MEMBER`, `LAST_OWNER`, `ROLE_CHANGE_NOT_ALLOWED`, `INVALID_INVITATION_ROLE`) e interfaces dos três repositórios (paginação por cursor, lock da organização, consumo condicionado ao e-mail, emissão condicional do token).
- **Ajuste na T1**: `OrganizationRole`, `ORGANIZATION_ROLES` e `isOrganizationRole` foram para o `shared/kernel`, porque o domínio de organizations precisa deles e não pode importar `application`; a `shared/application` os reexporta (API da T1 inalterada).
- **Testes** (132): slug (5 válidos, 10 formatos inválidos, 4 reservados), nome (normalização, limites, bidi, zero-width), política **tabela-driven com oráculo independente** (64 combinações de alteração de papel, autoalteração, 16 de remoção, 16 de convite), convite (prazo, nunca owner, reenvio, revogação), organização e membership.
- **Mutation testing**, 5/5 detectadas: admin altera owner (3 falhas); admin altera o próprio papel; admin remove owner (a primeira tentativa não casou com o texto e foi refeita); sem slugs reservados (4); convite concede owner.
- **Comandos**: `nx run-many -t lint typecheck test` (shared/kernel, shared/application, shared/http, organizations/domain) ✔.

### T6 — 2026-10-09

- **Entregue**: `prisma/models/organizations.prisma` (enum `organization_role`; `Organization`, `Membership`, `Invitation`) e a migration `20261009203057_add_organizations`, gerada com `--create-only` no banco descartável `taskflow_e2e` (o banco de desenvolvimento **não** foi migrado: aplicar com `pnpm db:migrate`).
- **SQL revisado e completado à mão**: `CHECK` de formato/tamanho do slug (BR-022), nome aparado com 2–80 caracteres, e-mail do convite normalizado, papel do convite ≠ `owner` (BR-021), aceite × revogação mutuamente exclusivos, aceite sempre com `accepted_by_user_id`; índice único parcial `invitations_one_open_per_email_idx` (BR-020); índice `(user_id)` em memberships como exceção documentada no design.
- **Testes**: cobertos pela suíte de integração da T7 (constraints rejeitam slug inválido, convite `owner`, aceite + revogação e segundo convite aberto para o mesmo e-mail).

### T7 — 2026-10-09

- **Entregue**: `libs/backend/organizations/infrastructure` (`type:infrastructure`, alias e alvo `integration-test` iguais aos de identity); mapeadores (papel desconhecido lança erro); cursor keyset; `PrismaOrganizationRepository` (P2002 ⇒ `SlugTakenError`, BR-008 por versão, `lockForMembershipChange` com `FOR NO KEY UPDATE` sem tocar `version`); `PrismaMembershipRepository` e `PrismaInvitationRepository` com `organizationId` em toda leitura **e** escrita, P2002 ⇒ `AlreadyAMemberError`/`OpenInvitationExistsError`, consumo em um único `UPDATE … RETURNING` condicionado ao e-mail e emissão do token condicionada ao `deliveryEventId`.
- **Bug encontrado e corrigido**: as fábricas do domínio copiavam a entrada inteira (`...input`) para o estado, levando `now` para o snapshot; o Prisma rejeitou o campo desconhecido. As fábricas passaram a montar o estado campo a campo, e um teste de domínio fixa as chaves do snapshot (domínio: 133 testes).
- **Testes de integração** (15, Testcontainers): constraints da T6, unicidades mapeadas, escrita com `organizationId` de B não altera nada, conflito de versão, serialização do lock (ordem `fk-insert → first-done → second-locked` e `version` inalterada), paginação estável, consumo e emissão do token. Passaram 3 vezes seguidas.
- **Mutation testing**, 5/5 detectadas: `FOR UPDATE` no lugar de `FOR NO KEY UPDATE` (bloqueia o insert com FK); sem lock; escrita de membership sem `organizationId`; consumo sem condição de e-mail; token emitido por evento antigo.
- **Comandos**: `vitest run --config vitest.integration.config.mts` (organizations/infrastructure) ✔ 15/15; `nx run-many -t lint typecheck test` (domain e infrastructure de organizations, identity/domain, shared/*) ✔ 22/22.

### T8 — 2026-10-09

- **Entregue**:
  - `identity`: `UserRepository.findByIds` (Prisma com `findMany … in` e fake); `GetUserAccountsUseCase` (ids deduplicados → `{ id, name, email, emailVerified }`, sem campos internos, teto `MAX_ACCOUNTS_PER_QUERY` = 100) e `FindUserIdByEmailUseCase`, exportados pela `identity/application`.
  - `libs/backend/organizations/application` (`backend-organizations-application`, `type:application`, aliases `@taskflow/backend/organizations/application` e `/testing`), com a porta `UserDirectory` (`getAccounts` indexado por id e `findUserIdByEmail`) e o fake `InMemoryUserDirectory` (registra as consultas para os testes de N+1 e aplica o mesmo teto).
- **Nota de consistência**: a porta `UserDirectory` (design, revisão 2) cobre a BR-013 pelo campo `emailVerified` e substitui a `EmailVerificationChecker` citada em `requirements.md` e no design da spec 001. A `GetUserVerificationStatusUseCase` da spec 001 continua existindo. O exemplo em `docs/architecture/dependency-rules.md` será atualizado na T24.
- **Correção de configuração encontrada no caminho**: oito `vitest.config.mts` (`identity/{domain,application,http}`, `organizations/domain`, `shared/{kernel,application,http}` e a lib nova) tinham o `exclude` corrompido por um gerador (`'../../../..integration.spec.ts'`), o que deixaria um teste `*.integration.spec.ts` rodar na suíte unitária. Os globs voltaram a ser `'**/*.integration.spec.ts'` e `'**/node_modules/**'`, iguais aos de `identity/infrastructure`.
- **Testes**: casos de uso (campos públicos e verificação atual, ids desconhecidos ou repetidos, lista vazia, teto contado por ids distintos, busca por e-mail normalizado); fake (2); integração do `findByIds` (identity: 50/50).
- **Boundary**: import de `@taskflow/backend/identity/domain` em `organizations/application` ⇒ erro de `@nx/enforce-module-boundaries` (sonda removida).
- **Mutation testing**, 5/5 detectadas: sem deduplicação; campo interno vazado; `emailVerified` fixo; teto frouxo; `findMany` sem filtro de ids (integração).
- **Comandos**: `nx affected -t lint typecheck test` ✔ (13 projetos); `nx run backend-identity-infrastructure:integration-test` ✔ 50/50.

### T9 — 2026-10-09

- **Entregue** (`organizations/application`):
  - `CreateOrganizationUseCase`. Ordem: limite de 5 tentativas/dia por usuário (conta também slug recusado, contra enumeração) → BR-013 pela `UserDirectory` → nome e slug (BR-022) → transação com os tetos de 20 organizações como owner e 100 memberships → organização + membership `owner` → evento `organizations.created`.
  - `ListMyOrganizationsUseCase`: duas consultas, memberships e organizações em lote.
  - `GetOrganizationUseCase`.
  - `RenameOrganizationUseCase`: RBAC pelo papel do tenant, BR-008 pela versão enviada, slug intocado.
  - `ResolveTenantMembershipUseCase`: uma consulta pelo único `(organization_id, user_id)`.
  - Erros `EMAIL_NOT_VERIFIED`, `ORGANIZATION_LIMIT_REACHED`, `ORGANIZATION_NOT_FOUND` e `INSUFFICIENT_ROLE` (403 do RBAC, que o design deixava sem código); views; eventos de segurança tipados.
- **Apoio**:
  - `OrganizationRepository.findByIds` (Prisma + integração) para evitar N+1 em "minhas organizações".
  - Os fakes genéricos (`FakeTransactionRunner`, `FixedClock`, `SequentialIds`, `InMemoryOutbox`, `InMemoryRateLimiter`, `fakePseudonymizer`) foram para `@taskflow/backend/shared/application/testing`, porque agora dois contextos os usam. `identity/application/testing` os reexporta, sem mudar a API.
  - Fakes de repositório e `createOrganizationsTestbed`.
- **Decisões de implementação (dentro do design)**:
  - Renomear não trava a organização: não altera memberships, e o papel resolvido na própria requisição basta.
  - Os tetos de 20/100 são lidos sem lock por usuário. Duas criações simultâneas podem exceder o teto em uma unidade; o limite de 5/dia mantém o excesso pequeno. Fica registrado no código.
- **Testes** (16 casos de uso + 2 do fake):
  - CA-01: verificado vira owner; não verificado e conta desconhecida recusados sem gravar nada.
  - CA-02: nome inválido, slug inválido, reservado e em uso, com rollback sem membership órfã.
  - CA-12: a 6ª tentativa ⇒ `RateLimitedError` com 86 400 s, contando tentativas recusadas.
  - Tetos de owner e de memberships.
  - Lista sem N+1 e sem organizações alheias.
  - Renomear com matriz de papéis, conflito de versão e nome inválido.
  - Resolvedor nega quem não é membro e organização inexistente.
- **Mutation testing**, 9/9 detectadas: sem limite de criação; BR-013 sem checar verificação; teto de owner frouxo; teto de memberships frouxo; criador sem `owner`; renomear sem RBAC; renomear sem BR-008; versão antiga na resposta; resolvedor com argumentos trocados.
- **Comandos**: `nx affected -t lint typecheck test` ✔ (13 projetos); `nx run backend-organizations-infrastructure:integration-test` ✔ 16/16; `prettier --check` nos arquivos alterados ✔.

### T10 — 2026-10-09

- **Entregue** (`organizations/application`):
  - `ListMembersUseCase`: cursor, página limitada a 25 por padrão e 100 no máximo, contas em uma consulta por página. `name`/`email` nulos só se a conta sumir de identity.
  - `ChangeMemberRoleUseCase` e `RemoveMemberUseCase`, este cobrindo também a saída (alvo = ator). Ambos seguem a mesma sequência:
    1. Negação rápida pelo papel do middleware, antes de travar.
    2. `lockOrganizationAndRereadActor`: `FOR NO KEY UPDATE` e releitura do ator; ator removido ⇒ 404.
    3. Alvo (de outra organização ⇒ `MEMBER_NOT_FOUND`), versão (BR-008), BR-019, política BR-021.
    4. Gravação.
    5. Revogação, na mesma transação, dos convites abertos de quem é removido ou passa a não poder convidar.
  - Eventos `member_role_changed`, `member_removed` e `member_left`. Alterar para o mesmo papel não grava nem registra evento.
  - Fake `InMemoryInvitationRepository`, com a semântica do Prisma.
- **Ajuste para cumprir o CA-08 aprovado**: a checagem do último owner (BR-019) vem **antes** da política de papéis (BR-021). No rebaixamento mútuo, quem perde já foi rebaixado e é relido como admin. Com a política primeiro, receberia `ROLE_CHANGE_NOT_ALLOWED`, e o cenário aprovado exige `409 LAST_OWNER`. A ordem é segura: o ator é membro relido sob lock, os papéis são visíveis a todos os membros e nada é gravado. Remover o único owner também responde `LAST_OWNER`, seja quem pedir.
- **Falha da T7 corrigida**: `PrismaInvitationRepository.save` mantinha o `token_hash` no reenvio. Agora o apaga quando o `delivery_event_id` muda. Antes, um reenvio suprimido pelo limite estendia por mais 7 dias o link antigo, violando o CA-06. Novo teste de integração cobre o caso (mutante detectado).
- **Testes**:
  - 37 unitários na application: matriz de admin com dois owners; único owner ⇒ `LAST_OWNER` para alteração e remoção; saída; ator rebaixado ou removido; BR-008; alvo de outra organização; revogação só para quem perde o poder de convidar; sem N+1; teto de página.
  - 4 de integração concorrente com PostgreSQL. Uma barreira com prazo dentro de `countOwners` força o pior entrelaçamento; com o lock, a segunda transação não chega até ela:
    - CA-08: rebaixamento mútuo ⇒ um sucede, o outro `LAST_OWNER`, e sobra 1 owner;
    - CA-08: as duas saem ao mesmo tempo ⇒ sobra 1 owner;
    - admin rebaixado enquanto a remoção que pediu espera o lock ⇒ a remoção é negada;
    - admin rebaixado enquanto a promoção que pediu espera o lock ⇒ a promoção é negada.
  - Integração de organizations: 21/21, três execuções seguidas.
- **Mutation testing**, 9/9 detectadas: sem lock (4 testes de integração falham); remoção e alteração decidindo pelo papel do middleware; BR-019 frouxo; nunca revogar convites ao rebaixar; remoção sem revogar; saída registrada como remoção; N+1 no diretório; sem negação rápida. Dois mutantes passaram na primeira rodada (papel do middleware na remoção, só visto pela integração; e a negação rápida, que não muda o resultado mas evita o lock). Os testes unitários foram reforçados e passaram a detectá-los.
- **Comandos**: `nx affected -t lint typecheck test` ✔ (13 projetos); `nx run backend-organizations-infrastructure:integration-test` ✔ 21/21; `prettier --check` ✔.

### T11 — 2026-10-09

- **Entregue** (`organizations/application`):
  - `InviteMemberUseCase`. Ordem:
    1. negação rápida;
    2. e-mail e papel (`INVALID_INVITATION_ROLE` para owner), antes de gastar limite;
    3. 429 por conta (30/dia) e por organização (50/dia), antes do lock;
    4. lock + releitura do convidante e `canInvite`;
    5. `ALREADY_A_MEMBER`;
    6. 429 por (organização, e-mail) (1/10 min);
    7. reconvite (papel atualizado, convidante = ator, prazo renovado, link anterior invalidado) ou convite novo.

    `created` distingue 201 de 200.

  - `ListInvitationsUseCase`: pendentes e expirados, convidantes em uma consulta.
  - `ResendInvitationUseCase`: quem reenvia vira o convidante, porque é ele que o aceite revalida.
  - `RevokeInvitationUseCase`: sob o lock, que o aceite (T12) também toma.
  - `InvitationDelivery` centraliza limites e agendamento. O **id do evento da outbox é o `delivery_event_id`**. Acima do limite por destinatário (3/dia, 10/semana, chave pseudonimizada, somando organizações), o evento não entra na outbox, mas o convite muda de envio mesmo assim (link antigo invalidado) e a resposta não muda.
  - Evento `organizations.invitation_requested` (`{ invitationId }`); eventos de segurança `invitation_created`, `invitation_resent` e `invitation_revoked`, sem e-mail; erro `INVITATION_NOT_FOUND` (404 para inexistente, de outra organização ou encerrado).
- **Concorrência**: todos os caminhos que criam convite travam a organização, então dois convites simultâneos ao mesmo e-mail viram convite + reconvite. Não é preciso capturar a violação do único parcial, o que de qualquer forma é inviável no PostgreSQL, porque uma violação aborta a transação. O `OpenInvitationExistsError` continua mapeado (409) como defesa na T13. O teste concorrente com banco fica na T12, junto com aceite × revogação.
- **Testes** (21 novos; 57 na application):
  - Convite novo: view, outbox e lock.
  - **Resposta idêntica com e sem conta.**
  - Reconvite: papel, convidante, prazo, link antigo inválido.
  - `ALREADY_A_MEMBER`; owner recusado e entrada inválida sem gastar limite; negação rápida e releitura do convidante.
  - CA-12: 1 por (organização, e-mail) a cada 10 min, inclusive revogar+recriar; 429 por conta e por organização; supressão silenciosa no 4º e-mail ao mesmo destinatário, sem e-mail em claro nas chaves.
  - CA-06: reenvio invalida o link e renova o prazo; revogação impede o consumo.
  - 404 para convite revogado ou de outra organização; listagem com expirado e convidante.
- **Mutation testing**, 13/13 detectadas: sem limite por destinatário; `delivery_event_id` diferente do evento; reconvite sem atualizar o papel; sem `ALREADY_A_MEMBER`; convite decidido pelo papel do middleware; reenvio sem limite por e-mail; reenvio sem trocar o convidante; lista sem RBAC; expirado listado como pendente; revogação dupla aceita; sem limites por conta/organização; revogação sem negação rápida; reenvio de convite revogado.
- **Comandos**: `nx affected -t lint typecheck test` ✔ (13 projetos); `prettier --check` ✔.

### T12 — 2026-10-09

- **Entregue** (`organizations/application`):
  - `LookupInvitationUseCase`: qualquer conta autenticada, inclusive não verificada; nome da organização e do convidante, e-mail mascarado (`b***@exemplo.com`), `isForCurrentUser`; nada é consumido.
  - `AcceptInvitationUseCase`. Ordem do design: `EMAIL_NOT_VERIFIED` → conta errada (`INVITATION_FOR_ANOTHER_ACCOUNT`, sem consumir) → inválido. Sob o lock:
    1. releitura do convite pelo token;
    2. revalidação do convidante (removido ou sem poder de conceder o papel ⇒ inválido);
    3. `ALREADY_A_MEMBER`;
    4. teto de 100 memberships;
    5. consumo condicionado ao e-mail + membership na mesma transação.

    Evento `invitation_accepted`.

  - Porta `InvitationTokenGenerator` (design); o composition root ligará o `CryptoSecretTokenGenerator` existente, que é estruturalmente compatível, sem duplicar a criptografia. Fake `FakeInvitationTokens` com SHA-256 real.
  - Erros `INVALID_OR_EXPIRED_INVITATION` (400) e `INVITATION_FOR_ANOTHER_ACCOUNT` (403).
- **Testes**:
  - 14 unitários novos (71 na application):
    - CA-04: aceite com o papel do convite;
    - CA-05: outra conta ⇒ 403 sem consumir, e a convidada ainda aceita; usado, revogado, expirado e desconhecido ⇒ 400 indistinto;
    - BR-013 antes da conta errada, com o convite preservado;
    - convidante removido ou rebaixado; já membro ⇒ 409 com o convite aberto; teto ⇒ 422 sem consumir;
    - consumo perdido ⇒ 400 sem membership;
    - prévia mascarada; máscara.
  - 4 de integração com PostgreSQL:
    - dois convites simultâneos ao mesmo e-mail ⇒ convite + reconvite, 1 linha e 2 eventos na outbox, sem 500 (pendência da T11);
    - aceite × revogação simultâneos, 5 rodadas ⇒ exatamente um vence e o banco fica coerente (aceito com membership, ou revogado sem);
    - revogação esperando um aceite em andamento ⇒ 404, nunca violação do CHECK `closed_once`;
    - dois aceites do mesmo token ⇒ uma membership.
  - Integração de organizations: 25/25, três vezes seguidas.
- **Mutation testing**, 8/9 detectadas: BR-013 no aceite; 403 de outra conta; convidante rebaixado; teto frouxo; aceite sem lock (detectado depois que o teste determinístico de revogação esperando o aceite foi incluído); consumo perdido ignorado (idem, com o teste de defesa em profundidade); prévia sem máscara; `isForCurrentUser` fixo. **Equivalente**: retirar a checagem prévia de "já membro" não muda o resultado, porque o único `(organization_id, user_id)` falha e a transação desfaz o consumo. A checagem foi mantida para responder 409 antes do teto (422).
- **Comandos**: `nx affected -t lint typecheck test` ✔ (13 projetos); `pnpm test:integration` ✔ (shared 28, identity 50, worker 7, organizations 25); `prettier --check` ✔.

### T13 — 2026-10-10

- **Entregue**:
  - `libs/contracts`: contratos de organização, "minhas organizações", membros e convites, paginados; prévia do convite; consulta de página (padrão 25, máximo 100); `strictObject` nos comandos; o contrato de convite não aceita `owner`.
  - `libs/backend/organizations/http` (`type:presentation`): `createOrganizationsRouters` devolve dois routers:
    - `router`, para as rotas fora do tenant: `POST /organizations` (201 + `Location`), `GET /me/organizations`, `POST /invitations/lookup|accept`, com 429 por usuário;
    - `tenantRouter`, com `mergeParams` e caminhos relativos.

    Também traz `organizationsErrorMappings` e `no-store`. Parâmetros malformados respondem 404 do recurso.

  - `shared/http`: `createTenantScope` e `TENANT_PATH_PREFIX`. Montam `authenticate → csrf → tenantContext` uma única vez sobre `/organizations/:organizationId` e, abaixo, os routers dos contextos: ficam protegidos por construção (ADR 0012) e reutilizáveis pelas specs 003+.
  - `apps/api`:
    - `createOrganizationsModule`;
    - adaptador `createUserDirectory` (organizations → consultas públicas de identity);
    - o módulo de identity passa a expor `authenticate`, `csrf`, `userAccounts` e `userIdByEmail`;
    - `main.ts` monta `identity.router`, `organizations.router` e o tenant scope, e mescla os mapeamentos de erro.

    O token do convite usa o `CryptoSecretTokenGenerator` de identity, compatível com a porta.
- **Testes**:
  - contratos: 4;
  - `createTenantScope`: 4 (tenant resolvido, 404 sem membership, 401 antes, CSRF em mutação, sem capturar `POST /organizations`);
  - Supertest do router, 26 casos:
    - CA-01/CA-02 com `Location`, `EMAIL_NOT_VERIFIED`, `INVALID_SLUG`, `SLUG_TAKEN`, campo desconhecido;
    - CA-12: 429 com `Retry-After` na criação, no convite e em lookup/accept;
    - sessão e CSRF obrigatórios;
    - leitura e renomeação com RBAC e BR-008;
    - paginação e teto; papel e `LAST_OWNER`; remoção exigindo versão; saída ⇒ 404 na próxima requisição (CA-09);
    - convites 201/200/404; aceite só pela conta convidada;
    - **tabela de rotas**: as rotas fora do prefixo são exatamente as quatro previstas, e as 9 do tenant são relativas, cada uma com 401 sem sessão e 404 sem membership;
  - adaptador `UserDirectory` + alinhamento dos tetos de identity e organizations: 2.
- **Smoke da API compilada** (`dist/apps/api`, banco descartável `taskflow_e2e`, variáveis do `.env.example`): sobe; `GET /me/organizations`, rotas do tenant (com UUID válido ou não) e `POST /organizations` ⇒ 401 Problem Details; `GET /auth/csrf` ⇒ 204. O `/health/ready` respondeu 503 porque o container `taskflow-redis-1` do ambiente local estava só criado e, iniciado à mão, não publica porta. A API seguiu com fallbacks, como projetado. O container foi parado de novo.
- **Mutation testing**, 10/10 detectadas: escopo sem CSRF; sem `tenantContext`; sem `mergeParams`; criação sem CSRF; reconvite respondendo 201; `Location` errado; lookup sem limite; tenant sem `no-store`; DELETE sem exigir versão; "minhas organizações" sem sessão.
- **Pendente nesta área**: atualizar `.claude/rules/api-design.md`, `docs/security/multi-tenancy.md` e `.claude/rules/security.md` para o ADR 0012 (T24); OpenAPI (T15); A/B com PostgreSQL (T14).
- **Comandos**: `nx affected -t lint typecheck test build` ✔ (17 projetos); `prettier --check` ✔.

### T14 — 2026-10-10

- **Entregue**: alvo `integration-test` em `apps/api` (Vitest + Testcontainers, igual ao do worker) e `organizations-isolation.integration.spec.ts`. O teste usa a API real: `createApp`, `createOrganizationsModule`, `createTenantScope`, repositórios Prisma e CSRF real; só a sessão e a `UserDirectory` são fakes.
- **Testes** (4, PostgreSQL real):
  - **CA-03 / RNF-01**: os 9 endpoints sob o prefixo de B, chamados por quem só é membro de A, respondem 404 `ORGANIZATION_NOT_FOUND`, igual a uma organização inexistente. O banco de B (organização, memberships, convites) fica idêntico.
  - **CA-03**: ids **reais** de B sob o prefixo de A respondem 404, e o banco de B fica inalterado:
    - PATCH de membro, inclusive o owner de B ⇒ `MEMBER_NOT_FOUND`;
    - DELETE de membro ⇒ `MEMBER_NOT_FOUND`;
    - resend e revoke de convite ⇒ `INVITATION_NOT_FOUND`.

    As listas de A não contêm nada de B.

  - Ids malformados (organização, membro, convite) ⇒ 404, sem chegar ao banco.
  - **CA-09**: membro removido recebe 404 na requisição seguinte, e a organização some de "minhas organizações".
  - Três execuções seguidas, 4/4.
- **Mutation testing**, 3/3 detectadas: `membership.find` sem `organizationId` (3 testes falham); `invitation.findById` sem `organizationId`; parâmetro malformado repassado ao banco.
- **Comandos**: `nx run-many -t lint typecheck -p api` ✔; `vitest run --config vitest.integration.config.mts` (api) ✔ 4/4.

### T15 — 2026-10-10

- **Entregue**: `organizationsOpenApiPaths` e `organizationsOpenApiSchemas` (`organizations/http`), gerados dos schemas Zod de `@taskflow/contracts` e incluídos em `createTaskflowApiDocument`. São 13 operações em 8 caminhos, com segurança (cookie, CSRF), códigos de erro por status e o 404 de não membro descrito como resposta única (ADR 0012).
- **Testes**: o documento continua OpenAPI 3.1 válido (`@readme/openapi-parser`); todas as 13 operações estão descritas, e toda rota sob `{organizationId}` documenta 404. Um mutante que renomeia a rota de reenvio foi detectado.
- **Comandos**: `nx run-many -t lint typecheck test -p api backend-organizations-http` ✔ (api 31, http 26).

### T16 — 2026-10-10

- **Entregue**:
  - `SendInvitationUseCase` (`organizations/application`). Convite inexistente, encerrado ou expirado ⇒ descartado. Evento diferente do `delivery_event_id` vigente ⇒ descartado (`superseded`). Caso contrário, gera o token e o grava com `issueToken`, condicionado ao evento, aberto e não expirado; só então envia. Um retry do mesmo evento troca o token, e vale o link da última tentativa. O link usa o **fragmento** (`/invitations/accept#token=…`).
  - Porta `InvitationEmailTemplates`; `InvitationRepository.findForDelivery`, só para o worker, porque o id vem da própria outbox.
  - `ptBrInvitationEmailTemplates` (`organizations/infrastructure`), seguindo o RNF-08:
    - frase fixa "“Ana” convidou você para a organização “Acme” no TaskFlow, com o papel de …";
    - assunto só com o nome da organização entre aspas;
    - aviso "Se você não esperava este convite, ignore este e-mail";
    - um único link; saudação genérica.
  - Worker:
    - tipo `organizations.invitation_requested` na fila `emails`, com schema Zod do job (`invitationId` UUID);
    - `organizations-emails.module`, com o adaptador `UserDirectory` para identity;
    - o processador compõe os casos de uso dos dois contextos.
  - **Refatorações para dois usuários**: o layout de e-mail (`renderEmail`, `escapeHtml`, `EmailRecipient`) foi de identity para `shared/infrastructure`, e o `RecordingEmailSender` para `shared/application/testing`. Identity os reexporta.
- **Limite por destinatário**: aplicado ao agendar o envio (T11, `InvitationDelivery.schedule`): acima do limite, o evento não entra na outbox e nenhum e-mail sai, com o mesmo efeito de "aplicado no envio". Assim o limite não fica duplicado no worker, e o link anterior é invalidado mesmo quando o envio é suprimido.
- **Testes**:
  - 5 unitários do caso de uso: link no fragmento resolvendo para o convite; CA-06 com evento antigo fora de ordem descartado e link vigente preservado; retry substituindo o token; revogado, expirado e inexistente sem envio; frase sem nome.
  - 3 do template (aspas, aviso, um link, escape, saudação genérica).
  - 2 do processador da fila (despacho com `eventId`, payload inválido sem retry).
  - 2 de integração com PostgreSQL, Redis e **Mailpit** reais:
    - CA-04: convite entregue, com o link resolvendo para o convite;
    - CA-06: o reenvio invalida o link anterior, e o evento antigo, reprocessado depois, é descartado sem novo e-mail.
- **Mutation testing**: 7 detectados — token na query; sem checar convite encerrado (detectado depois que o teste foi corrigido: ele avançava o relógio antes e testava o revogado como expirado); sem o aviso; saudação com o nome do convidante (detectado depois que a asserção foi incluída); fila sem o tipo de convite (integração); e as duas defesas do evento, checagem prévia e emissão condicionada, removidas juntas. Cada uma dessas duas defesas, sozinha, é um mutante equivalente, porque a outra cobre.
- **Comandos**: `nx affected -t lint typecheck test build` ✔; `pnpm test:integration` ✔ (shared 28, organizations 25, identity 50, api 4, worker 9).

### T17 — 2026-10-10

- **Entregue**:
  - Porta `InvitationRetention` e `PurgeClosedInvitationsUseCase` (`CLOSED_INVITATION_RETENTION_DAYS = 30`, RNF-08).
  - `PrismaInvitationRetention`: remove em lotes de 1 000 linhas, em autocommit, como a retenção de identity, os convites com `accepted_at`, `revoked_at` ou `expires_at` anteriores ao corte. Convites abertos dentro do prazo nunca são tocados.
  - O job diário do worker (`maintenance.purge_expired_data`, 03:00 UTC) passa a incluir `closedInvitations` no relatório.
- **Testes**:
  - Caso de uso: corte = agora − 30 dias.
  - Integração: aceito, revogado e expirado antes do corte removidos, cada condição isolada; aceito e revogado depois do corte e o aberto mantidos; lotes de 2; segunda execução remove 0.
  - Job do worker com PostgreSQL e Redis reais: revogado há 31 dias removido, pendente mantido.
- **Mutation testing**, 5/5 detectadas: ignorar aceitos; ignorar expirados; um só lote; prazo de 7 dias; job sem a retenção de convites.
- **Comandos**: `nx affected -t lint typecheck test build` ✔; integração de organizations ✔ 26/26 e do worker ✔ 9/9.

### T18 — 2026-10-10

- **Entregue** (`apps/web/src/app/core/organizations`):
  - `OrganizationsApi` e `tenantUrl(organizationId, sufixo)`. As URLs tenant-scoped são montadas com o id resolvido da rota; **nenhum interceptor injeta o tenant** (ADR 0012).
  - Guards de contrato sem Zod, pelo mesmo motivo de bundle da spec 001.
  - `MyOrganizationsStore` (Signals): carga única compartilhada; `resolve(slug)` recarrega **uma vez** antes de "não encontrada"; `add`, `invalidate`, `reset`.
  - `ActiveOrganizationStore`, provido no layout de `/o/:slug`, que lê a organização resolvida pelo `organizationResolver`.
  - `OrganizationRouteReuseStrategy`, que **recria a área e os stores quando o slug muda**.
  - `homeRedirectGuard` em `/`: última organização deste usuário, senão a primeira, senão `/organizations/new`; falha de carga ⇒ `/organizations`.
  - `organizationNotFoundInterceptor`: 404 `ORGANIZATION_NOT_FOUND` de rota tenant-scoped ⇒ invalida a lista e leva a `/organizations` com aviso. Outros 404 não são afetados.
  - `LastOrganizationStorage`: `localStorage { userId, slug }`, ignorado para outro usuário e tolerante a storage bloqueado.
  - `provideOrganizations`: reseta a lista ao trocar de usuário e apaga a última organização quando a sessão termina.
  - `provideAuth` aceita `outerInterceptors` (por fora da renovação de sessão).
  - A home antiga (`features/home`) virou a home da organização (`/o/:slug`).
- **Bug encontrado pelos testes e corrigido**: o resolver injetava `AuthStore` depois de um `await`, fora do contexto de injeção (NG0203). As injeções agora acontecem antes do primeiro `await`.
- **Testes**: 9 de roteamento com `RouterTestingHarness` e as rotas reais:
  - CA-10: última organização, primeira, onboarding;
  - anônimo ⇒ login;
  - slug inexistente ⇒ `/organizations` com aviso;
  - troca de slug recria a área (2 instâncias, id correto);
  - CA-09: 404 do tenant invalida e redireciona; outro 404 não;
  - logout limpa storage e lista.

  Mais 5 do store (deduplicação, recarga única, falha e nova tentativa, contrato violado) e 3 do storage.

- **E2E**: com o redirecionamento de `/`, a jornada real `auth-journey` passa a terminar no onboarding. Os testes com sessão simulada passaram a simular `/me/organizations` (helper `support/organizations.ts`); sem isso, o seletor do cabeçalho receberia 401 da API real e encerraria a sessão simulada.
- **Mutation testing** (com a T19), 8/8 detectadas: sem recarga única; ignorar a última organização; reaproveitar a área na troca de slug; qualquer 404 do tenant redirecionando; logout sem limpar; última organização de outro usuário; sugestão sobrescrevendo slug editado; organização criada fora da lista.
- **Ambiente**: o `pnpm e2e` (alvo atomizado do Nx) esgotou as portas efêmeras locais, com cerca de 19 mil conexões em `TIME_WAIT` para a 3333, durante a espera pelos servidores. O Playwright foi rodado direto com `NX_LOAD_DOT_ENV_FILES=false`, porque o `.env` local do usuário tem `PORT=3333`, que vira a porta do inspector do Node e colide com a API. O container `taskflow-redis-1`, criado sem mapeamento de porta, foi recriado por `pnpm infra:up`, preservando o volume.
- **Comandos**: `nx run-many -t lint typecheck test build -p web web-e2e` ✔ (web 191 testes; bundle inicial 346,95 kB); Playwright ✔ 17/17, duas vezes seguidas (banco `taskflow_e2e`, Redis índice 2).

### T19 — 2026-10-10

- **Entregue** (`apps/web/src/app/features/organizations`):
  - `/organizations/new`: nome → slug sugerido, sem acentos, até o usuário editar o endereço; validação espelhando a BR-022 e o nome de 2–80 caracteres. Erros por `code`: no campo (`INVALID_SLUG`, `SLUG_TAKEN`, `INVALID_ORGANIZATION_NAME`, com foco) ou em alerta (`EMAIL_NOT_VERIFIED`, `ORGANIZATION_LIMIT_REACHED` e os comuns, como 429). Há aviso prévio para conta não verificada. No sucesso, a organização entra em "minhas organizações" e o usuário vai para `/o/:slug`.
  - `/organizations`: lista com o papel; estados de carregando, vazio (com dica de convite), erro com nova tentativa e aviso de "não encontrada".
  - Seletor no cabeçalho (`core/layout/organization-switcher`): organizações com `aria-current` na atual, "Todas as organizações" e "Criar organização".
- **Testes**: slug (12 casos); criação (sugestão, validação local sem chamar a API, sucesso, 3 erros de campo, 3 alertas, aviso de não verificado); lista (papéis e links, erro → nova tentativa → vazio); seletor no `AppShell`.
- **Comandos**: os mesmos da T18.

### T20 — 2026-10-10

- **Entregue** (`apps/web/src/app/features/organizations`):
  - `OrganizationApi`: todas as chamadas recebem o id explícito da organização ativa.
  - Espelho da BR-021 só para a interface (`role-policy.ts`); a decisão continua no servidor.
  - `MembersStore` e `InvitationsStore` (Signals), providos nos componentes e recriados com a área.
  - `/o/:slug/members`, com estados de carregando, erro com nova tentativa e "carregar mais". Membros:
    - papel escolhido num `select` e salvo por botão (o `select` não age sozinho, WCAG 3.2.2), com a versão;
    - remoção e saída com **confirmação na linha**, foco no "Confirmar";
    - erros por `code` em alerta focado (`LAST_OWNER`, `ROLE_CHANGE_NOT_ALLOWED`, `VERSION_CONFLICT` e `MEMBER_NOT_FOUND` recarregam a lista);
    - saída ⇒ `/organizations`.
  - Convites (só owner/admin): formulário de e-mail e papel, nunca owner; lista com convidante e prazo ou "Expirado"; reenviar recarrega a lista; revogar com confirmação. Mensagens de convite novo e de reconvite são diferentes.
  - `/o/:slug/settings`: renomear com a versão carregada, slug exibido como fixo, somente leitura para member/viewer. `VERSION_CONFLICT` recarrega e explica; o novo nome entra em "minhas organizações".
  - Navegação da área: Início, Membros, Configurações.
- **Testes**: 15 de componente com as rotas reais e o backend simulado:
  - CA-07: owner troca o papel com a versão; admin sem opção owner e sem ações sobre owners; member/viewer só leitura e sem convites;
  - CA-08: `LAST_OWNER` em alerta focado;
  - BR-008: conflito recarrega;
  - remoção só após confirmação, com foco; saída com cancelar e confirmar;
  - convites: lista, convidar, `ALREADY_A_MEMBER`, 429, reenviar e revogar;
  - configurações: versão, conflito, somente leitura.

  Mais 12 da política espelhada.

- **Mutation testing**, 8/8 detectadas: admin oferecendo owner; papel com versão fixa (detectado depois que o teste passou a usar versão 3 em vez de 1); remoção sem confirmação; sair sem deixar a área; renomear com versão fixa; conflito sem recarregar; convites para quem não gerencia; admin removendo owner.
- **Comandos**: `nx run-many -t lint typecheck test build -p web` ✔ (218 testes).

### T21 — 2026-10-10

- **Entregue**:
  - `/invitations/accept`, sem guard. O token é lido do fragmento por `LinkToken`, que foi movido de `features/auth` para `shared/links` porque agora tem dois usos; auth o reexporta. A URL é limpa na hora, e o token fica em `PendingInvitation`, **só em memória**.
  - A prévia (`lookup`) não consome o convite, e o aceite exige clique. Estados:
    - sem token: orienta a reabrir o link, que vale 7 dias;
    - sem sessão: entrar ou criar conta com `returnUrl=/invitations/accept`, só o caminho, e "Já entrei em outra aba";
    - carregando;
    - pronto: frase com os nomes entre aspas e prazo;
    - e-mail não verificado: "Já confirmei meu e-mail" relê o `/me`;
    - conta errada: e-mail mascarado, sem botão de aceite, token mantido;
    - já membro;
    - inválido: token descartado;
    - falha na prévia: token mantido, com "Tentar de novo".

    O aceite bem-sucedido põe a organização em "minhas organizações" e abre `/o/:slug`.
- **Testes** (11):
  - token fora da barra de endereço e fora de `localStorage`/`sessionStorage`, com os links de login e cadastro sem o token;
  - CA-04: prévia, nada aceito antes do clique, aceite e navegação;
  - CA-05: conta errada; convite inválido esquecido;
  - BR-013: não verificado → confirmar → pronto;
  - mapeamento de `INVITATION_FOR_ANOTHER_ACCOUNT`, `ALREADY_A_MEMBER` e `EMAIL_NOT_VERIFIED` no aceite, com o token mantido ou descartado conforme o caso;
  - token sobrevive ao login dentro do SPA; aba recarregada; falha de rede com nova tentativa.
- **Mutation testing**, 6/6 detectadas: aceite automático sem clique; conta errada vendo o botão; conta errada descartando o token; token em `sessionStorage`; falha de rede descartando o convite; token deixado na barra de endereço.
- **Comandos**: `nx run-many -t lint typecheck test -p web` ✔ (229 testes).

### T22 — 2026-10-10

- **Entregue**: `apps/web-e2e/src/organizations-journey.spec.ts`, uma jornada **real** do CA-11, sem simulações (web, API, worker, Mailpit), com dois contextos de navegador:
  1. A owner se cadastra, confirma o e-mail pelo Mailpit, cai no onboarding (CA-10) e cria a organização (CA-01).
  2. Ela convida o e-mail do convidado.
  3. O e-mail de convite chega com a frase fixa, os nomes entre aspas e o aviso (RNF-08).
  4. O link abre "entre ou cadastre-se", e o token não aparece em nenhuma URL.
  5. O convidado se cadastra e confirma o e-mail. Depois reabre o link (a aba saiu do SPA, como o design prevê), vê a prévia e aceita (CA-04).
  6. Ele aparece na lista da owner, que muda o papel para admin pelo `select` + "Salvar papel".
  7. O convidado vê a seção de convites (agora é admin) e sai com confirmação.
  8. **Isolamento pela interface** (CA-03, CA-09): reabrir a URL da organização leva a `/organizations` com "Organização não encontrada", e a owner já não o vê na lista.
- **Ambiente**: a execução completa faz 3 ou mais cadastros reais, e o limite `auth.register.ip` é de 5 por hora (RNF-05 da spec 001). Execuções seguidas no mesmo Redis o esgotam ("Muitas tentativas", visto no snapshot da falha). Antes de cada execução foram apagadas **só** as chaves `rate-limit:auth.register.ip*` e `rate-limit:auth.login.ip*` do índice 2, o descartável do E2E. No CI, o Redis é novo a cada execução.
- **Comandos**: Playwright (`NX_LOAD_DOT_ENV_FILES=false`, banco `taskflow_e2e`, Redis índice 2) ✔ **18/18, duas vezes seguidas** (17 anteriores + a jornada nova).

### T23 — 2026-10-10

- **`/review-code`**: nenhum bloqueante.
  - **Importante, corrigido**: a lista de convites não tinha "carregar mais", e o reconvite de um convite fora da página era tratado como novo. O painel ganhou paginação, e `OrganizationApi.invite` lê o status (`201` = novo, `200` = reconvite).
  - **Sugestões corrigidas**:
    - `MyOrganizationsStore.add` só mescla numa lista já carregada, sem criar lista parcial;
    - `reset` descarta respostas de uma sessão anterior (contador de geração);
    - "carregar mais" de membros e convites ficou protegido contra clique duplo;
    - a organização ativa reflete a entrada atual de "minhas organizações", então o próprio papel alterado e o nome renomeado aparecem na hora;
    - a fila `emails` lista explicitamente `organizations.invitation_requested`.
  - **Registradas**:
    - a limpeza dos limites de cadastro e login antes de E2E seguidos fica documentada (T24), em vez de um `globalSetup` que apagaria chaves e poderia atingir um Redis de desenvolvimento;
    - a retenção de convites varre a tabela sem índice para o `OR` de encerramento. Isso é aceitável no volume atual, num job diário fora do pico, e deve ser reavaliado com índices parciais se a tabela crescer.
- **`/security-audit`**: **nenhum Crítico ou Alto**.
  - **Baixo B1, corrigido**: um cursor forjado com JSON válido e id fora do formato UUID chegava ao PostgreSQL (`invalid input syntax for type uuid`), causando 500. O `decodeCursor` agora valida o UUID e não usa mais cast. O teste de integração cobre membros e convites, e o mutante que remove a validação falha com o erro do PostgreSQL.
  - **Baixo B2, sem alteração**: a linha apontada no design é a do **histórico** da revisão 2, que registra a recomendação da época. A revisão 3 registra a decisão do usuário de mostrar o e-mail a todos os membros. O histórico está correto.
  - **Médio M1, pendente de decisão do usuário**: o limite por destinatário soma todas as organizações (RNF-04 aprovado: 3/dia, 10/semana). Uma conta verificada com organização própria pode gastar esse limite de um e-mail qualquer, por exemplo convidando, revogando e reconvidando a cada 10 minutos. Os convites legítimos de outras organizações a esse e-mail passam a ser suprimidos em silêncio, ficando pendentes e sem link, sem que ninguém perceba. A correção (limite por par organização-destinatário mais um teto global alto, e/ou indicar ao admin que a entrega foi adiada) **muda uma decisão aprovada**, então exige revisão da spec. Não foi aplicada.
- **Testes novos**:
  - web: paginação de convites com clique duplo, reconvite 200, próprio papel atualizado, `add` sem lista parcial e resposta descartada após `reset` (234 testes);
  - integração: cursor forjado.
- **Comandos**: `nx run-many -t lint typecheck test -p web` ✔ (234); integração de organizations ✔ 18/18 no arquivo de persistência.

### T24 — 2026-10-10

- **Documentação atualizada**:
  - `docs/product/business-rules.md`: BR-019…BR-022, desvio da BR-007 (log de segurança até o contexto `audit`) e BR-013 como implementada.
  - `docs/security/multi-tenancy.md`: reescrito para o ADR 0012, com prefixo de caminho, `createTenantScope`, releitura sob lock, frontend sem interceptor de tenant e testes A/B com ids reais. Saíram o header `X-Organization-Id` e o campo `status`.
  - `docs/security/authorization.md`: o que está implementado, exclusão e transferência fora do escopo, e visibilidade do e-mail dos membros (decisão do usuário).
  - `.claude/rules/api-design.md` e `security.md`: prefixo do tenant como o nível de aninhamento permitido, montagem só pelo escopo, nunca `organizationId` no body, decisão sob lock.
  - `docs/architecture/dependency-rules.md`: bibliotecas de organizations e o que a spec 002 acrescentou a `shared/*`. Também foi corrigido um parágrafo partido que já existia ("Reg…ra de inclusão").
  - `bounded-contexts.md` e roadmap (equipes adiadas); índice de specs; `docs/development/testing.md` (jornada CA-11, limpeza segura dos limites de autenticação no índice do E2E, simulação de `/me/organizations`, `PORT` do `.env` contra o inspector do Node).
  - `acceptance.md`: evidência por critério.

  O ADR 0012 já estava "Aceito".

- **Regressão da T23 encontrada pelo E2E e corrigida**: com o contador de geração, o efeito de sincronizar a sessão rodava **depois** de o guard de `/` iniciar o carregamento para quem acabou de entrar, e descartava a resposta certa. O usuário caía no onboarding mesmo tendo organizações (`account-area.spec.ts`). Agora o store guarda o usuário dono da lista ou da busca, e `syncUser` só descarta dados de **outro** usuário. Um teste unitário reproduz a ordem real.
- **Comandos (gate final)**:
  - `pnpm exec prettier --check .` ✔;
  - `pnpm verify` ✔: 17 projetos, 895 testes unitários;
  - `pnpm test:integration` ✔: shared 28, identity 50, organizations 26, api 4, worker 9;
  - Playwright ✔ 18/18, duas vezes (banco `taskflow_e2e`, Redis índice 2, `NX_LOAD_DOT_ENV_FILES=false`).
- **Pendente**: decisão do usuário sobre o achado **M1** da auditoria (T23), o limite de convites por destinatário somando organizações. Corrigi-lo exige revisar o RNF-04.
