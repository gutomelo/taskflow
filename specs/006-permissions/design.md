# 006 — Permissões · Design técnico

- **Status**: Aprovado (revisão 2)
- **Requisitos**: [requirements.md](requirements.md)
- **Revisão de arquitetura**: feita (revisão 2 incorpora os achados)
- **Revisão de segurança**: feita (revisão 2 incorpora os achados)

## Solução proposta

**Shared Kernel de autorização** em `libs/backend/shared/kernel/src/lib/authorization` (ADR 0013): catálogos de permissões, papéis de projeto, guardas de runtime, as duas matrizes como `Record` **exaustivos, anotados e congelados**, e o papel efetivo (BR-023). Só dados e funções puras. Cada contexto continua decidindo no **seu** caso de uso, com o recurso e o estado relidos (sob lock onde a spec 002 já exige). Um grant `allow` responde só "este papel pode esta ação"; estado do recurso (último owner, alvo de BR-021, BR-003, projeto arquivado) continua no domínio do contexto dono.

Isso substitui a frase de `bounded-contexts.md` segundo a qual `identity` "expõe a política de autorização", que contradiz a spec 002.

**Negação por padrão** em três camadas: (1) compilador — matrizes com tipo explícito `Readonly<Record<Papel, Readonly<Record<Permissão, Grant>>>>`; (2) runtime — strings externas só entram por `isOrganizationPermission`/`isProjectPermission` (`Object.hasOwn` sobre o catálogo) e grants são comparados por igualdade estrita (`=== 'allow'`); `'constructor'`, `'__proto__'`, papel desconhecido ⇒ negado; (3) testes — esperado **transcrito literalmente** de `docs/security/authorization.md`, independente da matriz da implementação.

**Capacidades** (dica de interface, nunca autorização): `GET /organizations/{id}` e `GET /me/organizations` devolvem as permissões efetivas do usuário; cada membro listado traz `actions` (papéis para os quais o usuário atual pode alterá-lo, se pode removê-lo). O frontend remove `role-policy.ts` e `ActiveOrganizationStore.canManage` e passa a só ler capacidades.

**Configuração `membersCanCreateProjects`** (BR-024): coluna em `organizations`, editada por `PATCH` da organização (agora "atualizar": nome e/ou configuração) com versão e — corrigindo uma lacuna herdada da spec 002 — **decisão sobre o papel relido sob o lock da organização**.

**Isolamento verificável**: uma composição única dos routers do tenant (usada por `main.ts` e pelos testes); um harness de integração que (i) gera, para **toda** rota do escopo, o caso "A chama o prefixo de B ⇒ 404" e (ii) exige, por rota, casos declarados para cada **referência** (parâmetro de caminho, de query e campos `*Id` do corpo) com ids reais de B, provando 404/ausência e banco de B inalterado por snapshot **genérico** (todos os modelos com `organizationId`). Uma varredura do app inteiro falha se uma rota com `:organizationId` estiver fora do escopo ou se uma rota global não estiver numa allowlist justificada.

**RLS** adiado para a Fase 4 (ADR 0014, que substitui a parte "RLS — Proposto" do ADR 0004).

## Componentes envolvidos

| Projeto Nx                                  | Camada         | Mudança                                                                                                                                                                                                                   |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/backend/shared/kernel`                | domain         | + `authorization/`: catálogos, guardas, `ORGANIZATION_MATRIX` (`allow`/`deny`/`setting`), `PROJECT_MATRIX` (`allow`/`own`/`deny`), `organizationGrant`, `organizationPermissions`, `effectiveProjectRole`, `canOnProject` |
| `libs/backend/organizations/domain`         | domain         | `Organization.membersCanCreateProjects` + `updateSettings`; `canManageMembers` removido (checagens via catálogo); `memberActions(actor, target, isSelf)` sobre BR-021                                                     |
| `libs/backend/organizations/application`    | application    | `UpdateOrganization` (lock + releitura, BR-008, evento só quando muda); permissões por caso de uso (tabela abaixo); capacidades nas views; `actions` em `ListMembers` e `ChangeMemberRole`                                |
| `libs/backend/organizations/infrastructure` | infrastructure | Mapeamento e `save` da coluna                                                                                                                                                                                             |
| `libs/backend/organizations/http`           | presentation   | `PATCH` novo, DTOs com `capabilities`/`actions`, OpenAPI; **teste de paridade** catálogo do kernel × `libs/contracts`                                                                                                     |
| `libs/contracts`                            | contracts      | `organizationPermissionSchema`, `capabilities`, `memberActionsSchema`, `updateOrganizationRequestSchema` (`strictObject` + ≥ 1 campo)                                                                                     |
| `prisma`                                    | —              | `organizations.members_can_create_projects BOOLEAN NOT NULL DEFAULT true` (aditiva)                                                                                                                                       |
| `apps/api`                                  | app            | `modules/tenant-routers.ts` (composição única); `testing/tenant-isolation.ts` (harness, `listTenantRoutes`, varredura do app); `*.isolation-cases.ts` por contexto; `tsconfig`/coverage excluem `src/testing`             |
| `eslint.config.mjs`                         | —              | `no-restricted-syntax`: ler `params.organizationId` só em `shared/http/.../tenant-context.ts`                                                                                                                             |
| `apps/web`                                  | app            | `can(permission)` a partir de `capabilities` (desconhecidas ignoradas); membros/convites por `actions`/capacidades; recarregar a organização após mudar o próprio papel; opção nas configurações                          |

## Permissão por caso de uso (organizations)

| Caso de uso                                                               | Permissão exigida                            | Observação                                                                               |
| ------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `GetOrganization`, `ListMembers`                                          | `organization:read`                          | todo membro                                                                              |
| `UpdateOrganization` (nome, `membersCanCreateProjects`)                   | `organization:update`                        | decisão sobre o papel relido sob lock                                                    |
| `InviteMember`, `ListInvitations`, `ResendInvitation`, `RevokeInvitation` | `member:invite`                              | + `canInvite` sobre o papel do convite (BR-021)                                          |
| `ChangeMemberRole`                                                        | `member:change-role`                         | + `canChangeRole` sobre ator e alvo relidos (BR-019, BR-021)                             |
| `RemoveMember` (outro membro)                                             | `member:remove`                              | + `canRemove` relido; **remover significa remover outros**                               |
| `RemoveMember` (o próprio — sair)                                         | — (sempre permitido)                         | limitado só por BR-019; **não é permissão** do catálogo                                  |
| Revogar convites de quem perde o papel                                    | "o novo papel tem `member:invite`?"          | substitui `canManageMembers(newRole)`                                                    |
| `CreateProject` (spec 003)                                                | `project:create` (grant `setting` p/ member) | configuração lida **na mesma transação** (porta de `projects`, ver Transição para a 003) |

## Modelo de domínio

### Catálogo e matrizes (`shared/kernel/authorization`)

- **Organização** — `organization:read`, `organization:update`, `member:invite`, `member:change-role`, `member:remove`, `project:create`. Itens do documento sem comportamento (`organization:delete`, `transfer-ownership`, `team:manage`, `audit:read`) **ficam fora** até a spec que os implementa; `authorization.md` passa a marcá-los como "planejado".
- **Grant de organização**: `'allow' | 'deny' | 'setting'`; o único `setting` é member × `project:create` (BR-024). `organizationGrant(role, permission)` é por papel (usado nas negações rápidas, sem carregar configuração); `organizationPermissions(role, settings)` resolve `setting` e serve às capacidades e a `projects`.
- **Projeto** — `project:read`, `project:update`, `project:archive`, `project-member:manage`, `task:create`, `task:update`, `task:assign`, `task:delete`, `comment:create`, `comment:update`, `comment:delete`, `sprint:manage`, `board:configure`. Grant `'allow' | 'own' | 'deny'`; `own` = recurso criado pelo próprio usuário. Viewer: `deny` em tudo exceto `project:read` (inclusive `comment:update`).
- **`canOnProject(role, permission, { ownsResource })`**: `ownsResource` **obrigatório**, calculado pelo contexto dono sobre o recurso carregado (`createdBy === actor.userId`); `own` sem recurso ⇒ negado.
- **Papel efetivo** `effectiveProjectRole(organizationRole, projectRole | null)` (BR-023): owner/admin ⇒ `manager`; member ⇒ papel do projeto; viewer ⇒ `viewer` se participa; sem participação ⇒ `null` (404). Papel de projeto desconhecido vindo do banco ⇒ tratado como ausente (404) e registrado em log, como `tenant-context.ts` faz.

### Organizations

- `Organization.membersCanCreateProjects` (padrão `true`) e `updateSettings`.
- `memberActions(actorRole, target, isSelf)`: `changeRoleTo` = papéis permitidos por `canChangeRole` **excluindo o atual** (lista vazia = não pode alterar); `remove` = `canRemove` para **outros**, `false` para si (sair tem ação própria). As ações refletem BR-021, não BR-019: o último owner pode ver "rebaixar" e receber `LAST_OWNER` (aceito; a interface já trata).

## Modelagem de dados

`membersCanCreateProjects Boolean @default(true) @map("members_can_create_projects")` em `Organization`. Migration aditiva, sem backfill.

## Contratos

| Método | URI                                      | Permissão             | Request                                                     | Response                                                                                       | Erros                                 |
| ------ | ---------------------------------------- | --------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------- |
| GET    | `/api/v1/organizations/{id}`             | `organization:read`   | —                                                           | `Organization` + `membersCanCreateProjects` + `capabilities`                                   | 404                                   |
| PATCH  | `/api/v1/organizations/{id}`             | `organization:update` | `{ name?, membersCanCreateProjects?, version }` (≥ 1 campo) | `Organization` (idem)                                                                          | 400, 403, 404, 409 `VERSION_CONFLICT` |
| GET    | `/api/v1/me/organizations`               | autenticado           | —                                                           | `MyOrganization` + `capabilities` (só organizações do ator)                                    | —                                     |
| GET    | `/api/v1/organizations/{id}/members`     | `organization:read`   | —                                                           | `Member` + `actions: { changeRoleTo: Role[], remove: boolean }`                                | 404                                   |
| PATCH  | `/api/v1/organizations/{id}/members/{u}` | `member:change-role`  | (spec 002)                                                  | `Member` + `actions` calculadas com o papel do ator **relido sob lock** e o novo papel do alvo | (spec 002)                            |

O catálogo é espelhado em `libs/contracts` (o kernel não importa contracts); um teste em `organizations/http` garante a paridade de permissões e papéis. Nenhum DTO de entrada aceita `capabilities`.

**Eventos**: nenhum de integração. Evento de segurança `organizations.settings_changed` (`requestId`, `organizationId`, `actorUserId`, valor anterior e novo), só quando o valor muda.

## Segurança

- **Capacidades não autorizam** (RNF-02): mutações chamam a política com o estado lido na mesma transação; capacidades nunca entram em cache compartilhado (`no-store`).
- **Atualização da organização**: `UpdateOrganization` passa a usar `lockOrganizationAndRereadActor` — um admin rebaixado no meio não grava nome nem configuração (teste de integração concorrente).
- **Isolamento** — harness (`apps/api/src/testing/tenant-isolation.ts`), executado na integração com a composição real:
  1. `listTenantRoutes(scope)`: lê `router.stack` (Express 5.2 / router 2.2) só nesta função; desce em sub-routers montados em `/` (`slash`); **falha fechado** em sub-router montado com caminho e em camada sem `route` fora da allowlist de middlewares (`noStore`); teste de sanidade (lista não vazia, contém `GET /members`).
  2. **Varredura do app**: toda rota fica em `tenantCases` (método + caminho) ou em `globalRoutes` (allowlist com justificativa e teste próprio — ex.: `/me/organizations` só devolve organizações do ator); rota com `:organizationId` fora do escopo ⇒ falha.
  3. **Casos gerados** para toda rota do escopo: A (owner) chama o prefixo de B ⇒ 404 idêntico.
  4. **Casos declarados** por referência: cada parâmetro de caminho/query e campo `*Id` do corpo recebe uma variante com id real de B sob o prefixo de A ⇒ 404 (ou lista sem itens de B); qualquer 2xx em caso negativo falha; B é semeado com ids canário que não podem aparecer em respostas de A.
  5. **Snapshot genérico**: modelos com `organizationId` listados pelo DMMF do Prisma; linhas de B iguais antes e depois.
- **Lint**: `params.organizationId` só em `tenant-context.ts` (com `mergeParams`, um parâmetro filho homônimo teria precedência).
- **Ameaças tratadas**: divergência frontend × backend; permissão esquecida (compilador + testes); chaves de protótipo; rota nova sem isolamento; rota tenant montada fora do escopo; corrida rebaixamento × atualização de configuração.

## Concorrência e consistência

`PATCH` da organização: lock `FOR NO KEY UPDATE` + releitura do ator + BR-008 (`version`). Capacidades podem envelhecer entre leitura e ação; a API decide pelo estado atual e a interface recarrega no 403/409 e após alterar o próprio papel.

## Transição para a spec 003 (obrigações registradas)

1. **Configuração para `projects`**: porta `ProjectCreationSettings` em `projects/application`, ligada no composition root a uma consulta de `organizations`; lida **na mesma transação** da criação, com a organização bloqueada para compartilhamento (`FOR SHARE`), para não correr contra a alteração da configuração.
2. **Sem privilégio adormecido (BR-023)**: `project_members` com FK composta `(organization_id, user_id) → memberships ON DELETE CASCADE` (remover ou sair da organização apaga as participações na mesma transação); gravar papel de projeto acima do teto é recusado (viewer da organização ⇒ só `viewer`); rebaixar alguém a viewer na organização rebaixa também suas participações a `viewer` na mesma operação (porta de `organizations` para `projects`). Testes nomeados BR-023 para "remover e reconvidar" e "rebaixar e promover".
3. **Papel de projeto para `tasks`/`boards`**: porta `ProjectAccess` (specs 004/005), nunca consulta direta; mutações de papel/membros de projeto relêem papéis sob lock do projeto.
4. `task:assign` valida no caso de uso que o responsável tem papel efetivo não nulo no mesmo projeto (BR-003); o harness inclui `assigneeId` de B e de não participante de A.
5. Preparação para RLS (ADR 0014): `organization_id NOT NULL` em toda tabela filha e FKs compostas `(organization_id, id)`.
6. **Referências fora do caminho no harness** (achado Baixo da auditoria da T9): hoje `coverageGaps` só exige variante para parâmetros de caminho, porque nenhuma rota atual recebe ids na query ou no corpo. A primeira spec com referência por query ou corpo (ex.: `projectId`, `assigneeId`) declara essas referências no caso da rota e estende `coverageGaps` para exigir uma variante para cada uma. Junto com isso, troca a liberação de middlewares de contexto por nome de função (`CONTEXT_MIDDLEWARES`) por uma identidade explícita.

## Frontend

- `can(permission)` lê `capabilities` (strings desconhecidas ignoradas, `can` falha fechado); `canManage` e `role-policy.ts` saem.
- Membros: seletor mostra o papel atual + `actions.changeRoleTo`; remover só com `actions.remove`; convites com `can('member:invite')`; após alterar o próprio papel, recarrega a organização (capacidades novas).
- Configurações: nome e caixa "Membros podem criar projetos" com `can('organization:update')`, salvos com a versão; conflito recarrega.

## Observabilidade

`organizations.settings_changed` (log de segurança; desvio da BR-007 mantido como na spec 002).

## Decisões arquiteturais

| Decisão                               | Alternativas                                                                                        | Escolha e motivo                                                                                                            | ADR  |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---- |
| Onde vive o vocabulário de permissões | contexto `authorization`; `identity` expõe política; cópia por contexto; lib `shared/authorization` | **Shared Kernel em `shared/kernel`**: sem estado nem I/O, usado por vários contextos; decisões nos casos de uso             | 0013 |
| Papel efetivo                         | papel do projeto independente                                                                       | **Teto da organização calculado na leitura**, com as obrigações de gravação da 003 contra privilégio adormecido             | 0013 |
| Interface sabe o que mostrar          | espelho no frontend                                                                                 | **Capacidades e ações calculadas na API**                                                                                   | —    |
| Prova de isolamento                   | teste manual; manifesto declarativo de rotas                                                        | **Introspecção isolada + varredura do app + casos por referência + snapshot genérico**, na integração com a composição real | —    |
| RLS                                   | agora; spike agora                                                                                  | **Adiar para a Fase 4**, com gatilhos de reavaliação e preparação barata                                                    | 0014 |

## Riscos

| Risco                                              | Probabilidade | Impacto | Mitigação                                                                                |
| -------------------------------------------------- | ------------- | ------- | ---------------------------------------------------------------------------------------- |
| Mudança interna do router invalidar a introspecção | Baixa         | Alto    | Leitura isolada em `listTenantRoutes`, falha fechado e teste de sanidade                 |
| Capacidades confundidas com autorização            | Baixa         | Alto    | RNF-02, revisão de segurança, decisões sempre nos casos de uso                           |
| Matriz de projeto mudar ao implementar a 003       | Média         | Baixo   | Funções puras e testes literais; mudança vira revisão desta spec e de `authorization.md` |
| `shared/kernel` acumular regra com estado          | Média         | Médio   | Só dados e funções puras (ADR 0013); revisão                                             |
| Privilégio adormecido em participações de projeto  | Média         | Alto    | Obrigações da 003 (FK em cascata, teto na gravação, rebaixamento propagado)              |

## Histórico de revisões

| Revisão | Origem      | Mudanças principais                                                                                                                                                                                                                                                                                                                         |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Autor       | Versão inicial                                                                                                                                                                                                                                                                                                                              |
| 2       | Arquitetura | Tabela caso de uso → permissão; `canManageMembers` removido; grant de organização com `setting` e `organizationGrant` por papel; porta de configuração para a 003; composição única dos routers; paridade kernel × contracts; esperado literal nos testes; semântica de `actions`; ADR 0014 substitui a parte de RLS do 0004                |
| 2       | Segurança   | Harness com varredura do app, casos por referência, snapshot genérico e ids canário; "sair" fora do catálogo; `UpdateOrganization` sob lock com releitura; guardas contra chaves de protótipo; viewer sem `comment:update`; obrigações da 003 contra privilégio adormecido; lint de `params.organizationId`; evento com valor anterior/novo |
