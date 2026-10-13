# 006 — Permissões · Tarefas

Regras: uma tarefa por vez; marcar `[x]` somente com evidência executada (seção abaixo). Toda tarefa termina com `pnpm nx affected -t lint typecheck test` passando; tarefas com persistência ou harness também com `pnpm test:integration`.

## Bloco A — Vocabulário e domínio

| ID  | Tarefa                                                                                                                                                                                                                                                                                          | Depende de | Verificação                                                                                                                                        | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T1  | `shared/kernel/authorization`: catálogos, guardas (`Object.hasOwn`), `ORGANIZATION_MATRIX` (`allow`/`deny`/`setting`) e `PROJECT_MATRIX` (`allow`/`own`/`deny`) anotadas e congeladas, `organizationGrant`, `organizationPermissions` (BR-024), `effectiveProjectRole` (BR-023), `canOnProject` | —          | testes com esperado literal de `authorization.md`; inexistente, `'constructor'`, `'__proto__'`, papel inválido negados; `ownsResource` obrigatório | [x]    |
| T2  | `organizations/domain`: `membersCanCreateProjects` + `updateSettings`; `memberActions` (sem o papel atual; `remove` falso para si); `canManageMembers` removido em favor do catálogo                                                                                                            | T1         | testes de domínio; matriz da spec 002 continua verde                                                                                               | [x]    |

## Bloco B — Persistência e aplicação

| ID  | Tarefa                                                                                                                                                                                                                                                       | Depende de | Verificação                                               | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------- | ------ |
| T3  | Migration aditiva `members_can_create_projects` (default `true`); mapeamento e `save`                                                                                                                                                                        | T2         | integração: default e gravação com versão                 | [x]    |
| T4  | Casos de uso pela tabela caso de uso → permissão; `UpdateOrganization` (lock + releitura, BR-008, `settings_changed` só quando muda); capacidades em `GetOrganization`/`ListMyOrganizations`; `actions` em `ListMembers` e `ChangeMemberRole` (papel relido) | T2, T3     | fakes: CA-03, CA-04, CA-05; integração concorrente: CA-09 | [x]    |

## Bloco C — HTTP e isolamento

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                                                                        | Depende de | Verificação                                                                                                                                      | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| T5  | Contratos (`organizationPermissionSchema`, `capabilities`, `memberActionsSchema`, `updateOrganizationRequestSchema` com ≥ 1 campo), router, OpenAPI; teste de paridade kernel × contracts em `organizations/http`                                                                                                                                                             | T4         | Supertest (403/409/400); OpenAPI válido; paridade                                                                                                | [x]    |
| T6  | Composição única dos routers do tenant (`main.ts` e testes); harness em `apps/api/src/testing` (`listTenantRoutes` com falha fechada e sanidade, varredura do app com allowlist global, casos gerados, casos por referência, snapshot genérico por DMMF, ids canário); casos da spec 002 migrados; lint de `params.organizationId`; `tsconfig`/coverage excluem `src/testing` | T5         | rota temporária sem caso, rota tenant fora do escopo e camada sem `route` fazem o teste falhar (verificado e removido); integração verde (CA-07) | [x]    |

## Bloco D — Frontend

| ID  | Tarefa                                                                                                                                                                                                                                                  | Depende de | Verificação                                   | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------- | ------ |
| T7  | `can()` por capacidades (desconhecidas ignoradas); membros e convites por `actions`/capacidades; remoção de `role-policy.ts` e `canManage`; recarregar a organização após mudar o próprio papel; opção "Membros podem criar projetos" nas configurações | T5         | testes de componente (CA-03…CA-06); E2E verde | [x]    |

## Bloco E — Fechamento

| ID  | Tarefa                                                                                                                                                                                                                                                                | Depende de | Verificação                                                           | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- | ------ |
| T8  | ADR 0013 e ADR 0014 (com status do ADR 0004 atualizado); `authorization.md` (planejados, `member:remove` = outros, sem ⚪ de sair), `bounded-contexts.md`, `dependency-rules.md`, `business-rules.md` (BR-023, BR-024), `multi-tenancy.md`; índice de specs e roadmap | T1–T7      | verificação de links                                                  | [x]    |
| T9  | `/review-code` e `/security-audit`; correções; gate final                                                                                                                                                                                                             | T8         | sem bloqueantes / sem Críticos-Altos; `pnpm verify`, integração e E2E | [x]    |

## Evidências

### T1 — 2026-10-13

- **Entregue**: `libs/backend/shared/kernel/src/lib/authorization` (exportado pelo kernel):
  - catálogos `ORGANIZATION_PERMISSIONS` e `PROJECT_PERMISSIONS`, `PROJECT_ROLES`;
  - guardas `isOrganizationPermission`, `isProjectPermission` e `isProjectRole`, com `Object.hasOwn` sobre índices congelados;
  - matrizes com tipo explícito e congeladas (`allow`/`deny`/`setting` na organização; `allow`/`own`/`deny` no projeto);
  - `organizationGrant` (por papel, para negações rápidas), `hasOrganizationPermission`, `organizationPermissions(role, settings)` (BR-024), `effectiveProjectRole` (BR-023, com `never` no `switch`), `projectGrant` e `canOnProject` (com `ownsResource` obrigatório).
- **Testes** (136 no kernel): esperado **transcrito literalmente** de `authorization.md`. São 24 pares de organização e 39 de projeto, mais o catálogo e os papéis. Também cobrem permissões e papéis hostis (`constructor`, `__proto__`, `toString`, maiúsculas, vazio, não string) negados; `setting` não conta como `allow` sem configuração; BR-024 (configuração liga e desliga o member, owner e admin sempre, viewer nunca); 10 casos do papel efetivo; `own` só para o dono, sem papel nega tudo, viewer não edita o próprio comentário.
- **Mutation testing**, 6/6 detectadas: guarda com `in` (que aceitaria chaves de protótipo); viewer sem teto; `own` sem checar o dono; member criando projeto sem configuração; configuração ignorada; member moderando comentários.
- **Comandos**: `nx run-many -t lint typecheck test -p backend-shared-kernel` ✔.

### T2 — 2026-10-13

- **Entregue** (`organizations/domain`):
  - `Organization.membersCanCreateProjects` (padrão `true`), `settings` e `updateSettings`, que devolve se houve mudança.
  - Política: `canManageMembers` **removido**. `canInvite`, `canChangeRole` e `canRemove` passam a exigir a permissão do catálogo (`member:invite`, `member:change-role`, `member:remove`), mantendo as restrições de alvo da BR-021.
  - `memberActions` (sem o papel atual; `remove` falso para si).
- **Troca mecânica nos 8 casos de uso** (necessária para o build continuar verde), pela tabela caso de uso → permissão do design: `organization:update` ao renomear; `member:invite` ao convidar, listar, reenviar e revogar; `member:change-role`; `member:remove` só para outros. A revogação de convites de quem perde o papel passa a perguntar "o novo papel tem `member:invite`?". A T4 completa a aplicação.
- **Testes**: domínio com 141 testes (8 de `memberActions`, configuração com e sem mudança, chaves do snapshot); a matriz da spec 002 continua verde; aplicação com 79.
- **Mutation testing**, 5/5 detectadas: ações incluindo o papel atual; remover a si mesmo como ação; member alterando papéis (20 testes falham); qualquer papel convidando; `updateSettings` sempre informando mudança.

### T3 — 2026-10-13

- **Entregue**:
  - Coluna `membersCanCreateProjects` em `prisma/models/organizations.prisma`.
  - Migration `…_add_members_can_create_projects`, gerada com `--create-only` contra o banco descartável `taskflow_e2e`: só `ADD COLUMN … BOOLEAN NOT NULL DEFAULT true`, aditiva e sem backfill. Foi aplicada ali com `migrate deploy`; o banco de desenvolvimento **não** foi migrado (`pnpm db:migrate`).
  - Mapeamento, `add` e `save` (com versão).
- **Testes**: integração com default `true`, gravação com versão 2 e o default da coluna conferido no `information_schema`. A integração de organizations passou com 27/27; um mutante que não grava a configuração falha.
- **Comandos**: `nx run-many -t lint typecheck test` (domínio, aplicação, infraestrutura, http, api, worker) ✔; integração de organizations ✔.

### T4 — 2026-10-13

- **Entregue** (`organizations/application`):
  - `UpdateOrganizationUseCase` substitui o `RenameOrganizationUseCase`: atualiza o nome e/ou `membersCanCreateProjects`. Faz uma negação rápida e depois **trava a organização e relê o ator** (`lockOrganizationAndRereadActor`), decidindo `organization:update` sobre o papel relido. Aplica BR-008 pela versão. O evento `organizations.settings_changed` (`requestId`, ids, `{ from, to }`) só sai quando o valor muda.
  - Views com `membersCanCreateProjects` e `capabilities` (`organizationPermissions(papel, settings)`), sem consulta extra.
  - `MemberView.actions` via `memberActions`, com o papel do middleware em `ListMembers` e o **papel relido sob lock** (o novo, quando o ator alterou o próprio) na resposta de `ChangeMemberRole`.
- **Testes**:
  - aplicação, 86: CA-03 (admin desliga a configuração e o member perde `project:create`, com o evento); evento ausente sem mudança; CA-09 com o papel relido (lock tomado, nada gravado); CA-04 nas duas leituras; CA-05 (admin sem ações sobre owners, member com `['admin','viewer']`); ações com o papel relido;
  - integração concorrente CA-09 com PostgreSQL: o owner rebaixa o admin enquanto a atualização deste espera o lock ⇒ 403, com nome, configuração e versão intactos (5/5 no arquivo).
- **Mutation testing**, 4/4 detectadas: decisão pelo papel do middleware (unitário **e** integração); capacidades ignorando a configuração; ações com o papel do middleware (detectado depois que o teste passou a cobrir o ator promovido); evento registrado sem mudança.

### T5 — 2026-10-13

- **Entregue**:
  - `libs/contracts`: `organizationPermissionSchema`; `updateOrganizationRequestSchema` (`strictObject` com `name?` e `membersCanCreateProjects?`, exigindo ao menos um campo, e `version`), que substitui o `renameOrganizationRequestSchema`; `capabilities` em `Organization` e `MyOrganization`; `actions` em `Member`.
  - Router com `PATCH` novo e DTOs copiados explicitamente; OpenAPI (corpo, resumo, componente `OrganizationPermission`); módulo da API.
  - **Teste de paridade** kernel × contracts (permissões e papéis) em `organizations/http`.
  - Web: as duas chamadas a `add()` levam as `capabilities` da resposta e as fixtures de teste foram tipadas. O resto do frontend é da T7.
- **Testes**: HTTP com 31 (configuração com 403/409, capacidades do member, PATCH vazio e campo `capabilities` no corpo ⇒ 400, viewer com capacidades só de leitura e sem ações, paridade 2); API com 31 (OpenAPI válido); web com 235.
- **Mutation testing**, 3/3 detectadas: catálogo divergente no contrato (pego pela paridade); PATCH vazio aceito; capacidades fora da resposta.
- **Comandos**: `nx run-many -t lint typecheck test` (contracts, http, api, web) ✔; integração (organizations 28, api 4) ✔.

### T6 — 2026-10-13

- **Entregue** (`apps/api`):
  - `modules/api-routers.ts` — `composeApiRouters(modules)`: a **composição única** de `/api/v1`, usada por `main.ts` e pelos testes. Cada contexto novo entra como campo obrigatório de `ApiModules`, e o compilador força os testes a montá-lo.
  - `testing/tenant-isolation.ts`:
    - `listTenantRoutes` e `listGlobalRoutes` concentram toda a leitura dos internos do Express 5. Falham fechado diante de sub-router montado com caminho, camada sem rota fora da allowlist (`noStore`) ou escopo com mais de uma camada;
    - `coverageGaps` (rota sem caso, parâmetro de caminho sem variante, caso para rota inexistente) e `globalViolations` (rota com `:organizationId` fora do escopo, rota global sem justificativa).
  - `testing/isolation-cases.ts`: casos por rota (variantes `not-found` para `:userId` e `:invitationId`, `no-leak` para as listas) e `GLOBAL_ROUTES`, que justifica as 17 rotas globais.
  - `tsconfig.app.json` exclui `src/testing`, o `tsconfig.spec` inclui e a cobertura ignora.
  - **Lint**: `no-restricted-syntax` proíbe ler `params.organizationId`/`params['organizationId']` fora de `tenant-context.ts` (sonda: 1 erro).
- **Teste de cobertura** (unitário, `route-coverage.spec.ts`), sobre a composição real com os routers reais de identity e organizations montados com fakes:
  - sanidade: 9 ou mais rotas de tenant, `GET /members` e `GET /me` presentes;
  - nenhuma lacuna;
  - rotas globais iguais à allowlist.

  Também testa o próprio harness: rota nova sem caso, parâmetro sem variante, sub-router com caminho, middleware desconhecido e rota de tenant fora do escopo são todos detectados.

- **Integração A/B reescrita** sobre o harness (5 testes, com a composição de `main.ts`):
  - caso gerado para **toda** rota (owner de A no prefixo de B ⇒ 404 `ORGANIZATION_NOT_FOUND`);
  - todas as variantes declaradas;
  - snapshot **genérico** de B: a organização mais toda tabela com `organization_id`, descoberta pelo `information_schema`;
  - **ids canário** de B ausentes das respostas de A (ignorando os ids que a própria requisição enviou, porque o `instance` do Problem Details repete o caminho);
  - `/me/organizations` só com as organizações do ator; ids malformados; CA-09 da spec 002.
- **Ajustes durante a validação**:
  - o primeiro desenho dos canários excluía as contas de B e deixou passar um vazamento real de listagem (mutante sobrevivente). Corrigido: contas que só pertencem a B são canários;
  - o `instance` do Problem Details foi tratado como acima.
- **Mutation testing**:
  - integração, 2/2 detectados: listagem de membros sem filtro de organização (ids de B vazam numa lista de A) e convite buscado sem organização (202 em vez de 404);
  - cobertura: os 4 cenários de falha acima.
- **Ambiente**: na primeira execução do gate completo, o `web:test` teve um erro não tratado num arquivo não alterado: um timer do `MatFormField` disparou depois de o jsdom ser desmontado, sob 53 tarefas em paralelo. Isolado, passou 235/235 três vezes, e o gate seguinte passou inteiro. Fica registrado para a T9 caso se repita.
- **Comandos**: `nx run-many -t lint typecheck test build` ✔ (17 projetos); `nx run api:integration-test` ✔ 5/5 (duas vezes); `prettier --check .` ✔.

### T7 — 2026-10-13

- **Entregue** (`apps/web`):
  - Guards de contrato exigem `capabilities` (lista de strings: permissões desconhecidas são aceitas e nunca casam), `actions` em membros e `membersCanCreateProjects`.
  - `ActiveOrganizationStore.can(permission)` substitui `canManage`.
  - Lista de membros: seletor = papel atual + `actions.changeRoleTo`; remover só com `actions.remove`.
  - `role-policy.ts` e seu spec foram **removidos**: não sobrou comparação de papel no código do web (grep vazio).
  - Ao mudar o próprio papel, a interface **recarrega** "minhas organizações" e a lista de membros, porque as regras voltam da API.
  - Convites aparecem com `can('member:invite')`.
  - Configurações: caixa "Membros podem criar projetos" com rótulo e dica associados, habilitada só com `can('organization:update')` e salva junto com o nome e a versão por `OrganizationApi.update`.
  - E2E: `support/organizations.ts` devolve capacidades por papel nas sessões simuladas.
- **Testes** (web: 226):
  - os specs de membros, configurações, criação e cabeçalho passam a receber da API simulada as `actions` e `capabilities`;
  - **CA-06**: lista sem ações ⇒ sem controles, mesmo para owner;
  - rebaixar a si mesmo recarrega organização e lista;
  - **CA-03**: admin desmarca e salva com a versão; o member vê a opção desabilitada.
- **Mutation testing**, 5/5 detectadas: `can()` sempre verdadeiro; papéis ignorando `actions`; remover sempre visível; sem recarga após mudar o próprio papel; member editando a configuração.
- **Comandos**: `nx run-many -t lint typecheck test -p web` ✔ (226); Playwright ✔ 18/18 (banco `taskflow_e2e`, Redis índice 2); `prettier --check .` ✔.

### T8 — 2026-10-13

- **Entregue**:
  - [ADR 0013](../../docs/architecture/adr/0013-authorization-shared-kernel.md): vocabulário de autorização como Shared Kernel e papel efetivo com teto, com as obrigações da spec 003.
  - [ADR 0014](../../docs/architecture/adr/0014-rls-deferred.md): RLS adiado para a Fase 4, com gatilhos de reavaliação, preparação barata e risco residual.
  - ADR 0004: só a linha de status mudou ("RLS: adiado para a Fase 4 — ver 0014"); o corpo ficou como registro histórico. O índice de ADRs foi atualizado.
  - `authorization.md`: catálogo no kernel; itens planejados (`organization:delete`, `transfer-ownership`, `team:manage`, `audit:read`) fora do catálogo; `member:remove` = remover outros, sair não é permissão; legenda `own`/`setting`; seção "Capacidades na API".
  - `bounded-contexts.md`: sem "identity expõe a política"; vocabulário no kernel, decisão no contexto, dados por portas.
  - `dependency-rules.md`: conteúdo de autorização do kernel, regra de inclusão e regra do escopo do tenant e do harness.
  - `business-rules.md`: BR-023 e BR-024 com estado.
  - `multi-tenancy.md`: RLS adiado (ADR 0014) e o harness descrito.
  - Roadmap: 006 "em validação final" e item de RLS da Fase 4 apontando para o ADR 0014. O índice de specs só muda ao concluir a T9.
- **Verificação**:
  - script de links relativos nos 10 documentos alterados: 0 quebrados;
  - os 5 caminhos de código citados existem;
  - grep sem referências obsoletas fora de registros históricos;
  - `prettier --check` em `docs/**/*.md` e `specs/**/*.md` ✔.

### T9 — 2026-10-13

- **`/review-code`**: veredito "pronto", sem bloqueantes. Corrigidos:
  - Importante: `GetOrganization` e `ListMembers` passam a exigir `organization:read` do catálogo (RF-01; hoje todos os papéis têm, mas a negação por padrão não depende mais disso).
  - Importante: falha ao recarregar as capacidades depois de mudar o próprio papel não é mais engolida. A interface avisa ("Recarregue a página") e `ActiveOrganizationStore.can` deixa de confiar em capacidades em memória enquanto a última recarga estiver em erro.
  - Sugestões aplicadas: `effectiveProjectRole` valida o papel de projeto (desconhecido ⇒ sem participação); a opção da configuração reage a mudanças de capacidade (`effect`); o snapshot do isolamento ordena pela linha inteira (tabelas sem coluna `id`); a varredura de rotas recusa middlewares montados com caminho próprio, nos routers globais e no nível do escopo.
- **`/security-audit`**: sem Críticos, Altos ou Médios. Dois achados Baixos (detecção, sem impacto atual):
  - lint de `params.organizationId` contornável → seletores para desestruturação, apelido de `params` e template literal (5 formas barradas, verificado com amostra via `eslint --stdin`). O `ignores` continua com `**/`: os configs dos projetos reexportam o da raiz e os caminhos ficam relativos ao projeto.
  - harness só exige variante para parâmetros de caminho → registrado como obrigação 6 da spec 003 no `design.md` (nenhuma rota atual recebe ids por query ou corpo).
- **Testes novos**:
  - aplicação: `organization:read` negado para papel fora do catálogo em runtime (`Reflect.set`, sem cast), em Get e List, este sem tocar o repositório;
  - kernel: 6 papéis de projeto desconhecidos ⇒ `null` para member e viewer;
  - web: recarga falha após rebaixar-se ⇒ convites somem e o aviso aparece; capacidade muda com a página aberta ⇒ a opção é desabilitada;
  - api: middleware com caminho próprio recusado (global e escopo).
- **Mutation testing**, 8/8 detectados: sem checagem de leitura (Get e List); `can()` ignorando erro de recarga; recarga engolida; `effect` sem dependência (`untracked`); papel de projeto sem validação; walker global aceitando qualquer camada; escopo aceitando middleware com caminho.
- **Gate final**:
  - `pnpm verify` ✔: 54/54 tarefas, lint, typecheck, test e build em 17 projetos. Contagens dos testes unitários: kernel 142, aplicação 88, http 31, api 39, web 228.
  - `pnpm test:integration --skip-nx-cache` ✔: 5 projetos, 120 testes (api 5/5 no harness de isolamento).
  - Playwright ✔ 18/18 (banco `taskflow_e2e` com `db:deploy` sem pendências, Redis índice 2, só chaves `rate-limit:auth.*` apagadas).
  - O erro do timer do `MatFormField` registrado na T5 não se repetiu.
