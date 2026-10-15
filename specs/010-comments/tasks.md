# 010 — Comentários e menções · Tarefas

Regras: uma tarefa por vez; marcar `[x]` somente com evidência executada (seção abaixo). Toda tarefa termina com `pnpm nx affected -t lint typecheck test` passando; tarefas com persistência, portas ou isolamento também com `pnpm test:integration` nos projetos afetados. Mutation testing manual nas regras novas.

## Bloco A — Domínio e persistência

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Depende de | Verificação                                                                                                                   | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| T1  | Bibliotecas `collaboration/{domain,application,infrastructure,http}` (tags; restrições de `domain:collaboration` em `eslint.config.mjs`); `MENTION_TOKEN` em `libs/contracts`; `collaboration/domain`: `parseCommentBody` (`isWellFormed`, normalização, controle, bidi, marcas combinantes, tokens canônicos, sem autor, ≤ 20), `Comment` (criar; editar com menções mantidas/novas e sem mudança quando o texto é igual; excluir idempotente; versão), erros | —          | testes de domínio (BR-031, BR-032); lint de boundaries                                                                        | [x]    |
| T2  | Prisma `collaboration.prisma` + back-relation inerte em `Task` + migration manual (`comments`, `comment_mentions`, FKs compostas com cascata, CHECKs, índices); lints `tasksMustNotReachOtherContexts` (barra `comments`) e `collaborationMustNotReachOtherContexts`; linha na tabela do ADR 0015                                                                                                                                                              | T1         | integração: catálogo (FKs, CHECKs, índices), cascatas tarefa → subtarefas → comentários e organização; lint com caso de falha | [x]    |
| T3  | `PrismaCommentRepository`: página por keyset `(created_at DESC, id DESC)`, achar e travar por `(organization_id, id)`, salvar com versão e menções, contagem de não removidos                                                                                                                                                                                                                                                                                  | T2         | integração (filtro de organização em leitura e escrita)                                                                       | [x]    |

## Bloco B — Fornecedores, aplicação e composição

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                                                                 | Depende de | Verificação                                                              | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ | ------ |
| T4  | Fornecedores: `tasks` (módulo) `LockTaskForDiscussion` e `ResolveTaskForDiscussion` (devolvem dados, sem decidir permissão) + `lockForShare` no repositório; `projects` `ListProjectReaderIds`; `organizations` sem mudança (reaproveita `GetMemberRolesUseCase`); `identity` `SearchUsersAmong` (keyset `(name, id)`, `ILIKE` escapado)                               | —          | testes de caso de uso; integração de `lockForShare` e `SearchUsersAmong` | [x]    |
| T5  | `collaboration/application`: `GetComment`, `ListComments`, `CreateComment`, `EditComment`, `DeleteComment`, `ListMentionCandidates`; portas `TaskDiscussionAccess` e `CollaborationUserDirectory` ("Ex-membro"); erros com os mesmos códigos dos reaproveitados; ordens de decisão (404 único por comentário; excluir sem checagem de estado); limites; eventos; fakes | T1, T4     | testes com fakes (CA-01..CA-06)                                          | [x]    |
| T6  | Composição em `apps/api` (`task-discussion-access.adapter.ts`, `collaboration-user-directory.adapter.ts`, `collaboration.module.ts`, `ApiModules.collaboration`, ordem de montagem); integração concorrente: comentar × cancelar, × excluir tarefa, × perda de acesso do mencionado; cascata da organização                                                            | T3, T5     | `*.integration.spec.ts` (CA-07)                                          | [x]    |

## Bloco C — HTTP, isolamento e autorização

| ID  | Tarefa                                                                                                                                                                                                                                                                                     | Depende de | Verificação                             | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------- | ------ |
| T7  | Contratos (`comments.contract.ts`, `body` com `.meta({ embeddedReferences: 'mentions' })`), router (6 rotas), mapeamento de erros (paridade), limites (`collaboration.comments.write.user.hour`, `collaboration.mentions.read.user.minute`), OpenAPI (tag Comments)                        | T6         | testes do router; `openapi.spec`        | [x]    |
| T8  | Harness: `inputReferences` reconhece `embeddedReferences` e exige a variante `body.mentions` (teste unitário de falha); casos das 6 rotas (`refused` 422 `INVALID_MENTION` para usuário de B e membro sem acesso); baterias de autorização e isolamento comparando o corpo inteiro dos 404 | T7         | `route-coverage.spec`; baterias (CA-08) | [x]    |

## Bloco D — Frontend e jornada

| ID  | Tarefa                                                                                                                                                                                                                                                             | Depende de | Verificação                                                                       | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------- | ------ |
| T9  | Seção "Comentários" no detalhe da tarefa: `CommentsStore`, segmentação pura (texto, menção, link, quebra; `<bdi>`, `dir="auto"`, links via `URL`), lista, carregar anteriores, "Ex-membro", editar, excluir com confirmação (também em só leitura), "mostrar mais" | T7         | testes de componente e da segmentação (cargas de XSS e bidi, paridade de menções) | [x]    |
| T10 | Composer com menções: intervalos `{start, end, userId}`, `serialize`/`deserialize` puros, combobox acessível com debounce, contador serializado                                                                                                                    | T9         | testes das funções puras e de componente (teclado)                                | [x]    |
| T11 | E2E real (continua a jornada de projetos e tarefas): comentar com menção, editar, excluir, tarefa cancelada sem composer e com excluir                                                                                                                             | T10        | Playwright no banco descartável (CA-10)                                           | [x]    |

## Bloco E — Documentação e validação

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                                                                                                                        | Depende de | Verificação                                                           | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- | ------ |
| T12 | Docs: `bounded-contexts.md` (Collaboration implementado; setas `COL → TSK/PRJ/IAM`; fronteira `collaboration × tasks`; ordem de locks estendida e invariante), `dependency-rules.md` (bibliotecas e lints), `business-rules.md` (BR-031, BR-032; exceção de exclusão em BR-026/BR-029), `authorization.md` (`comment:*` aplicadas), `multi-tenancy.md` (referências em texto), `testing.md`, `data-flow.md`; índice e roadmap | T1–T11     | verificação de links                                                  | [x]    |
| T13 | `/review-code` e `/security-audit`; correções; gate final                                                                                                                                                                                                                                                                                                                                                                     | T12        | sem bloqueantes / sem Críticos-Altos; `pnpm verify`, integração e E2E | [x]    |

## Evidências

### T1 — 2026-10-14

- **Entregue**:
  - Biblioteca `backend-collaboration-domain` (`libs/backend/collaboration/domain`, tags `scope:backend`, `domain:collaboration`, `type:domain`; alias em `tsconfig.base.json`). As restrições de `domain:collaboration` já vinham de `BOUNDED_CONTEXTS` em `eslint.config.mjs`.
  - `comment-content.ts`: `CommentContent.parse` / `parseCommentBody` com surrogate sem par, NFC, `\r\n`→`\n`, bordas aparadas, 1–5 000 code points, controle `\p{Cc}` exceto `\n`/`\t`, formatação bidi U+202A–202E/U+2066–2069, mais de 3 marcas combinantes; tokens `<@uuid>` reescritos em minúsculas; autor fora das menções; até 20 distintas. `MENTION_TOKEN` exportado.
  - `comment.ts`: `Comment` (`create`, `restore`, `newMentionsIn`, `edit` → `{ changed, addedMentionUserIds }`, `delete` idempotente, `snapshot`).
  - Seis erros (`COMMENT_NOT_FOUND`, `INVALID_COMMENT_BODY`, `TOO_MANY_MENTIONS`, `INVALID_MENTION`, `COMMENT_DELETED`, `COMMENT_LIMIT_REACHED`).
- **Desvios do texto da tarefa** (sem mudar o design):
  - Só a biblioteca de domínio foi criada: `application`, `infrastructure` e `http` nascem nas tarefas que lhes dão código (T5, T3, T7), pela regra "sem bibliotecas vazias".
  - O contrato do repositório entra na T3, junto da implementação.
  - O domínio não pode importar `libs/contracts`, então a cópia de `MENTION_TOKEN` em contratos e o teste de paridade ficam na T7 (camada HTTP, que enxerga os dois).
  - Como em `tasks`, a versão é incrementada pelo repositório ao gravar, não pela entidade.
- **Testes**: 21 (`comment-content.spec.ts` 14, `comment.spec.ts` 7), entre eles NFC, limite em code points, controle, bidi (M2), surrogates e marcas combinantes (B6), RTL e emoji com ZWJ aceitos, tokens canônicos, autor ignorado (inclusive com id em maiúsculas), tokens malformados como texto, teto de 20, menções novas contra o conjunto atual (D10), texto igual sem mudança, exclusão idempotente.
- **Mutation testing**: 22 mutantes, 22 mortos (um sobrevivente inicial — o id do autor chegando em maiúsculas — virou teste).
- **Achado de processo**: o formatador gravou como caracteres literais os escapes `\u` de strings e regex (inclusive bidi invisível no fonte). Foram trocados por escapes explícitos e conferidos com `grep -P` (nenhum bidi literal em `libs/backend/collaboration` nem na spec).
- **Gate**: `pnpm nx affected -t lint typecheck test --base=master` — exit 0, 26 projetos.

### T2 — 2026-10-14

- **Entregue**:
  - `prisma/models/collaboration.prisma` (`Comment`, `CommentMention`); back-relation inerte `Task.comments`.
  - Migration `20261015090000_add_comments`: SQL gerado por `prisma migrate diff` contra o `taskflow_e2e`, mais os CHECKs manuais `comments_deleted_body_check` (D4) e `comments_body_length_check` (1–5 000 em `char_length`). Aplicada ao `taskflow_e2e`; `migrate diff --exit-code` depois dela: 0 (sem diferença).
  - Lints: `tasksMustNotReachOtherContexts` barra `comment`, `commentMention` e `select/include` de `comments`; nova `collaborationMustNotReachOtherContexts` barra os modelos de `tasks`, `projects`, `organizations` e `identity`, exceto em `*.integration.spec.ts`.
  - Biblioteca `backend-collaboration-infrastructure` criada agora porque o teste de catálogo precisa dela; o repositório entra na T3, e até lá o `index.ts` não exporta nada.
  - Linha nova na tabela de exceções do ADR 0015 em `docs/architecture/bounded-contexts.md`.
- **Testes**: `collaboration-schema.integration.spec.ts`, com 7 testes:
  - catálogo das FKs (ações e definição) e dos CHECKs e índices;
  - coerência da exclusão lógica;
  - tamanho em code points;
  - comentário só em tarefa do mesmo projeto e organização;
  - menção só em comentário da mesma organização, sem repetição;
  - cascatas: tarefa com subtarefas e organização.
- **Lint com caso de falha**: arquivos de sonda com `transaction.task` em `collaboration` e `transaction.comment` / `select: { comments }` em `tasks` deram 3 erros ADR 0015, e os arquivos foram apagados em seguida.
- **Mutation testing**: 5 mutantes na migration (sem CHECK de coerência, limite 5 001, `octet_length`, FK `RESTRICT`, FK de menção sem organização), 5 mortos.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=master` exit 0 (27 projetos). `integration-test` de `backend-tasks-infrastructure` (24) e `backend-collaboration-infrastructure` (7) passando.

### T3 — 2026-10-14

- **Entregue**:
  - Contrato `CommentRepository` em `collaboration/domain` (`add`, `findById`, `lockById`, `save` com versão, `page`, `countActive`) e `CommentPosition`.
  - `PrismaCommentRepository`:
    - toda consulta filtra `organizationId`; as menções também;
    - `lockById` faz `FOR NO KEY UPDATE` parametrizado e relê a linha;
    - `save` usa `updateMany` com a versão e a incrementa; troca as menções apagando as que saíram e inserindo as novas com `skipDuplicates`;
    - `page` usa keyset `(created_at DESC, id DESC)`;
    - `countActive` conta os não removidos.
  - O cursor opaco e a amarração à tarefa ficam na aplicação (T5), como o cursor do quadro na 005.
- **Testes**: `collaboration-persistence.integration.spec.ts` (6 testes):
  - adicionar e achar com menções, só na organização;
  - página com empate resolvido por id, só da tarefa;
  - edição com versão e troca de menções; versão velha dá `VERSION_CONFLICT`;
  - removido sem texto nem menções, fora da contagem;
  - `save` forjado com outra organização não grava;
  - lock só em transação e serializando quem escreve.
- **Mutation testing**: 10 mutantes, 10 mortos: filtro de organização na página, na gravação e na contagem; ordem e desempate; versão; troca de menções; removidos na contagem; `FOR NO KEY UPDATE`; menções na criação.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=master` exit 0. `integration-test` de `backend-collaboration-infrastructure`: 13 testes passando.

### T4 — 2026-10-14

- **Entregue**:
  - **`tasks`**: `LockTaskForDiscussionUseCase` faz `findById` → `lockForContribution` (projeto e memberships `FOR SHARE`) → `lockForShare` da tarefa. `ResolveTaskForDiscussionUseCase` resolve a leitura. Os dois devolvem dados ou `null`, sem decidir permissão. O repositório ganhou `lockForShare` (SQL parametrizado `FOR SHARE`, filtrando organização e projeto), e o fake também (`sharedTaskLocks`).
  - **`projects`**: `ListProjectReaderIdsUseCase` reúne participantes com papel efetivo (viewers inclusive) e owners/admins, em páginas de 200. `MAX_PROJECT_READER_IDS` = 1000; acima disso devolve `complete: false`.
  - **`identity`**: `UserRepository.searchAmong` (nome ou e-mail com `ILIKE` entre os ids dados, keyset `(name, id)`) e `SearchUsersAmongUseCase` (cursor opaco; cursor adulterado recomeça a busca; mais de 1 000 ids é `RangeError`, erro de programação).
  - **`organizations`**: sem mudança. "Ex-membro" usa o `GetMemberRolesUseCase` existente; design e tarefa ajustados (era `CurrentMembers`).
- **Achado**: o `contains` do Prisma **não** escapa `%` e `_`. Confirmado pelo mutante sem escape, que falha a integração. `searchAmong` escapa `\`, `%` e `_`.
- **Testes**:
  - `discussion.use-cases.spec.ts` (6);
  - `contribution.use-cases.spec.ts` (+2: leitores, inclusive viewers, owner e admin uma vez só, sem quem saiu; teto);
  - `user-directory.use-cases.spec.ts` (+3);
  - integração `lockForShare` em `tasks-persistence` (dois `FOR SHARE` convivem e quem escreve espera; outra organização dá `null`; só em transação);
  - integração `searchAmong` em `identity` (só entre ids, sem diferenciar maiúsculas, `%` e `_` literais, keyset).
- **Mutation testing**: 16 mutantes, 14 mortos e 2 tratados:
  - `disc-member` era equivalente (`projects` já devolve `null` para quem não é membro): a checagem redundante foi removida do código;
  - `search-next` (página exata) virou teste e morreu.
  - A checagem do papel na organização em `ListProjectReaderIds` é defensiva: com a cascata da FK não há participação sem membership. Registrada como equivalente.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=master` exit 0 (27 projetos). `integration-test` de `backend-tasks-infrastructure` (25) e `backend-identity-infrastructure` (51) passando.

### T5 — 2026-10-14

- **Entregue**:
  - Biblioteca `backend-collaboration-application`, com aliases `…/application` e `…/application/testing`.
  - **Portas**: `TaskDiscussionAccess` (`lockForComment`, `resolveForRead`, `mentionCandidates`, que devolve `null` quando há leitores demais) e `CollaborationUserDirectory` (`displayNames` só de membros atuais; ausente = "Ex-membro").
  - **Erros**: classes próprias com os mesmos códigos de `tasks`: `TASK_NOT_FOUND`, `INSUFFICIENT_ROLE`, `PROJECT_ARCHIVED`, `TASK_CANCELED`, `INVALID_CURSOR`. Mais o novo `TOO_MANY_READERS`.
  - **Limites**: `collaboration.comments.write.user.hour` (300) e `collaboration.mentions.read.user.minute` (120); teto suave de 2 000 comentários por tarefa; `lock_timeout` de 2 s.
  - **Eventos** `collaboration.comment_{created,edited,deleted}`, só com ids.
  - **Cursores** da conversa e dos candidatos, amarrados à tarefa (e ao texto buscado).
  - **Visões** com ações por papel, posse e estado.
  - **Casos de uso**: `ListComments` (`count` só na primeira página), `GetComment`, `ListMentionCandidates`, `CreateComment`, `EditComment` (trava só as menções novas; menção nova fora do que foi travado dá `CONCURRENT_UPDATE`), `DeleteComment` (sem checagem de estado — decisão 9 —, idempotente depois do 403).
- **Ordem de decisão implementada**: a entrada (400/422) é validada antes do lock, depois de contar a tentativa no limite.
  - **Por tarefa**: 404 → 403 → arquivado → cancelada → menções → teto.
  - **Por comentário**: só `COMMENT_NOT_FOUND`.
- **Testes**: `comment.use-cases.spec.ts`, com 20 testes cobrindo CA-01 a CA-06 nos fakes:
  - eventos e locks;
  - mesmo corpo de `INVALID_MENTION` para sem acesso, outra organização e inexistente;
  - teto de menções antes do lock;
  - teto por tarefa contando só não removidos;
  - limite contando recusas;
  - paginação, "Ex-membro" e nomes numa chamada por página;
  - ações por papel e estado;
  - cursores (outra tarefa, adulterado, data inválida);
  - 404 único por comentário;
  - edição (menções novas, menção mantida de quem perdeu acesso, texto igual, ordem de decisão, autor rebaixado);
  - exclusão (moderação, idempotência, em só leitura);
  - candidatos.
- **Mutation testing**: 32 mutantes, 31 mortos (3 sobreviventes viraram testes). `task-mismatch` era equivalente (o `taskId` do comentário nunca muda) e a checagem saiu do código.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=master` exit 0.

### T6 — 2026-10-14

- **Entregue**:
  - **Exposição nos fornecedores**: `tasks.discussion` (`lockForComment`, `resolveForRead`), `projects.contribution.readerIds` e `identity.searchUsersAmong`.
  - **Adaptadores**: `task-discussion-access.adapter.ts` (leitores de `projects` sem o ator, busca em `identity`, `null` se a lista estiver incompleta) e `collaboration-user-directory.adapter.ts` (só membros atuais, por `organizations.access.rolesOf`, contas em lotes de 100).
  - **`collaboration.module.ts`**: só os casos de uso. O router, o `ApiModules.collaboration` e a ligação no `main.ts` entram na T7, junto das rotas, para não deixar módulo sem uso no `main.ts`.
- **Ajuste**: as menções da visão passam a sair na ordem da primeira aparição no texto, porque o banco não guarda ordem. A integração mostrou ordem pela chave primária.
- **Testes**:
  - `comments-composition.integration.spec.ts` (6, composição real e PostgreSQL):
    - menções a owner e viewer, nomes, `INVALID_MENTION` para quem não lê, candidatos, "Ex-membro" depois de sair da organização, `count`;
    - comentar × cancelar nos dois sentidos (quem cancela espera o `FOR SHARE`; quem comenta espera o cancelamento e recebe `TASK_CANCELED`);
    - comentar × excluir tarefa (comentário recusado ou apagado junto, nunca órfão);
    - remover o mencionado do projeto espera o comentário que trava a membership; depois, a menção é recusada;
    - moderação em tarefa cancelada, edição recusada ali, cascata da organização.
  - `collaboration-adapters.spec.ts` (3 testes unitários dos adaptadores).
  - `comment.use-cases.spec.ts` (+1: ordem das menções).
- **Mutation testing**: 6 mutantes, 6 mortos: ordem das menções, lista incompleta, exclusão do ator, filtro de membros, lote de contas. `adapter-complete` sobreviveu na integração e morreu com o teste unitário.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=master` exit 0 (28 projetos). `integration-test` de `api` (51) e `backend-collaboration-infrastructure` (13) passando.

### T7 — 2026-10-14

- **Entregue**:
  - **Contratos**: `libs/contracts/src/lib/collaboration/comments.contract.ts`, com `MENTION_TOKEN_PATTERN`, o registro `embeddedReferences` (Zod) e `commentBodySchema` registrado nele (até 10 000 unidades no transporte; a regra de 5 000 code points é do domínio). Também os schemas de parâmetros, comandos `strictObject`, consultas e respostas.
  - **Biblioteca `backend-collaboration-http`**: router com as 6 rotas. Parâmetro malformado responde 404 (`TASK_NOT_FOUND` ou `COMMENT_NOT_FOUND`). A criação devolve 201 com `Location: …/comments/{id}`; a exclusão devolve 204.
  - **Mapeamentos de erro** com os mesmos títulos de `tasks` para os códigos compartilhados.
  - **OpenAPI**: tag Comments.
  - **Ligação**: `ApiModules.collaboration`, `main.ts`, `integration-api.ts` (só `identity` em memória), `route-coverage.spec` e o documento OpenAPI.
- **Testes**:
  - `catalog-parity.spec.ts` (2): a gramática do token é igual no domínio e nos contratos; todo código de erro tem mapeamento.
  - `collaboration-router.spec.ts` (6, contra os schemas): fluxo completo, candidatos, 400 (campos desconhecidos, `mentions`, `authorUserId`, `organizationId`, texto, versão, limite, cursor), 404 com um código por tipo de rota e o mesmo título, 403/409/422, CSRF obrigatório.
  - `openapi.spec.ts` (+1): as 6 operações com 404 e a tag; os filtros de contagem de organizations e tasks foram ajustados.
- **Mutation testing**: no router, 3 mutantes, 3 mortos (404 por comentário, `Location`, 204).
- **Gate**: `pnpm nx affected -t lint typecheck test --base=master` exit 0.

### T8 — 2026-10-14

- **Entregue**:
  - **Harness**: `referencesOf` reconhece campos registrados em `embeddedReferences` e passa a exigir a variante `<campo>.mentions`. A exigência é derivada do schema e falha fechado (B1 da segurança, S7 da arquitetura). O ator `'dual-member'` foi acrescentado às variantes.
  - **Casos das 6 rotas**: tarefa e comentário de B dão 404; cursor real de B dá 400 `INVALID_CURSOR` na conversa e nos candidatos; menção a usuário só de B dá 422 `INVALID_MENTION` na criação e na edição (esta pelo autor, o membro duplo).
  - **Mundo do isolamento**: comentário de A e dois de B (cursor). As tabelas `comments` e `comment_mentions` entram sozinhas no snapshot e nos canários, porque têm `organization_id`.
  - **Bateria nova `comments-authorization.integration.spec.ts`** (5 testes):
    - cobre as rotas de comentário;
    - quem não lê o projeto (membro e viewer de fora, participante só de P2) recebe o mesmo corpo de "não existe", com um código por tipo de rota;
    - viewer participante recebe 403 em toda escrita antes de erro de estado;
    - member não edita nem exclui o alheio (403 antes da versão) e manager não edita o alheio, mas modera;
    - IDOR entre projetos: menção a quem só está em P2 recusada, inclusive para o owner; candidatos de P1 sem essa pessoa; comentário de P2 inexistente para o manager de P1.
  - A bateria de `tasks` deixou de contar as rotas de comentário.
- **Testes**: `route-coverage.spec` (+1: texto com referência exige variante; texto comum não). `api` unitário 53. `api:integration-test` 56 (o `organizations-isolation` percorre as 6 rotas novas com os dois atores).
- **Mutation testing**: sem a detecção de `embeddedReferences` no harness, o teste de falha quebra (morto).
- **Gate**: `pnpm nx affected -t lint typecheck test --base=master` exit 0. `api:integration-test`: 56 testes passando.

### T9 — 2026-10-14

- **Entregue** em `apps/web/src/app/features/tasks/comments/`:
  - `comments-contract-guards.ts`, `comment-api.ts` e `comments.messages.ts` (pt-BR).
  - `comment-body.ts`: segmentação pura em `text`, `mention`, `link` e `newline`. O token está espelhado do contrato. Um link só vale para `http(s)` com host, termina antes de espaço, `<`, `>` e `\p{Cf}`, perde a pontuação final e mostra o rótulo normalizado pelo `URL` (IDN em punycode). Também `relativeTime` e `absoluteTime`.
  - `comments.store.ts`: carga cronológica, "carregar anteriores", criar, editar e excluir (relê o comentário), contagem; recarga em `VERSION_CONFLICT`, `CONCURRENT_UPDATE`, `COMMENT_NOT_FOUND`, `COMMENT_DELETED`, `TASK_CANCELED` e `PROJECT_ARCHIVED`.
  - `task-comments.ts`, montado no detalhe da tarefa:
    - lista com autor ou "Ex-membro", data relativa com a absoluta no `title`, "(editado)", "Comentário removido";
    - texto com `dir="auto"` e `unicode-bidi: isolate`, menções e links em `<bdi>`;
    - "mostrar mais" acima de 600 caracteres;
    - editar e excluir com confirmação; composer com contador;
    - aviso de só leitura (projeto arquivado, tarefa cancelada ou papel);
    - recarrega só quando a tarefa aberta muda de id ou de cancelamento.
  - Nenhum `innerHTML`, `bypassSecurityTrust*` ou `contenteditable`.
- **Pendente para a T10**: o composer ainda é um `textarea` simples (a edição mostra os tokens `<@id>` crus). Menções pelo teclado e (des)serialização entram na T10.
- **Testes**:
  - `comment-body.spec.ts` (8): paridade do token com os contratos; menções por nome atual e "Ex-membro"; token desconhecido como texto; links só `http(s)` e sem pontuação final; `javascript:`, `data:`, `ftp:` e cargas de XSS como texto; link que para em RLO, em ZWSP e em `<`, com a menção dentro do link ainda visível; IDN; data relativa em pt-BR.
  - `task-comments.spec.ts` (6): conversa cronológica com "Ex-membro", "editado" e removido, "carregar anteriores"; XSS literal e só links `http(s)` com `rel`; comentar mantendo o rascunho na recusa e anunciando o sucesso; editar e excluir com confirmação, recarga em conflito, contagem; tarefa cancelada sem composer nem editar, mas com excluir (decisão 9); erro com "Tentar de novo".
  - `web`: 323 testes.
- **Mutation testing**: 12 mutantes, 11 mortos. `label-normalized` sobreviveu, virou asserção e morreu. `protocol` é equivalente (a regex só captura `http(s)`) e fica como defesa.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=master` exit 0.

### T10 — 2026-10-14

- **Entregue**:
  - **`mention-text.ts`** (funções puras):
    - `applyEdit`: diferença mínima entre os textos; intervalos antes da edição ficam, os depois são deslocados, e a edição dentro de um intervalo o desfaz;
    - `insertMention`: troca o `@consulta` por `@Nome ` e devolve o cursor;
    - `serialize` (`<@id>`), `serializedLength` (code points) e `deserialize` (tokens viram `@Nome` ou `@Ex-membro`; token desconhecido continua texto);
    - `activeQuery`: `@` no início ou depois de espaço, 1–50 caracteres, fora de menção.
  - **`comment-composer.ts`** (`tf-comment-composer`):
    - `textarea` com `role="combobox"`, `aria-expanded`, `aria-controls` e `aria-activedescendant`, mais um listbox de opções;
    - setas com volta, Enter ou Tab inserem, Esc fecha, perder o foco fecha;
    - busca com debounce de 250 ms em que só a resposta mais recente vale;
    - contador do tamanho serializado e envio do texto serializado;
    - sem `contenteditable`.
  - **`TaskComments`** usa o composer para o comentário novo (limpa depois de enviar) e para a edição (abre com `deserialize`).
- **Testes**:
  - `mention-text.spec.ts` (6): serialização e tamanho; desserialização com "Ex-membro" e token desconhecido; edição antes, exatamente no início, depois e dentro de menções; token colado como texto; inserção deslocando menções e posicionando o cursor; regras da consulta ativa.
  - `task-comments.spec.ts` (+2): menção pelo teclado no combobox (opções, `aria-activedescendant`, setas com volta, Enter, corpo com o token, campo limpo depois do envio); Esc fecha; resposta atrasada depois de perder o foco não reabre a lista; edição mostrando `@Caio` e devolvendo o token.
  - `web`: 331 testes.
- **Mutation testing**: 10 mutantes, 7 mortos de primeira. Os 3 sobreviventes (inserção no início da menção, volta das setas, busca obsoleta) viraram testes e morreram.
- **Gate**: `pnpm nx affected -t lint typecheck test --base=master` exit 0.

### T11 — 2026-10-14

- **Entregue**: passo "spec 010" em `apps/web-e2e/src/projects-journey.spec.ts`, com as mesmas contas (sem cadastros novos):
  - o owner cria PDC-5 e comenta mencionando o membro pelo teclado (`@Membro` → opção no listbox "Pessoas para mencionar" → Enter);
  - o owner edita mantendo a menção ("(editado)");
  - o membro responde e não tem ações no comentário do owner;
  - o owner modera e o comentário vira "Comentário removido";
  - o owner cancela a tarefa: aviso de só leitura, sem composer nem editar, com excluir.
- **Ajuste**: a primeira execução falhou porque `getByRole('option')` também achava a opção do `<select>` de responsável. O seletor passou a se restringir ao listbox de menções.
- **Execução**: `pnpm exec playwright test -c apps/web-e2e/playwright.config.mts` com `.env.example` exportado, `DATABASE_URL=…/taskflow_e2e` (com `add_comments` aplicada), `REDIS_URL=…/2` e as chaves `rate-limit:*` do índice 2 limpas antes. Resultado: **19 passed (43,5 s)**, `exit=0`.
- **Gate**: `web-e2e` lint e typecheck verdes.

### T12 — 2026-10-14

- **Documentado**:
  - `bounded-contexts.md`: Collaboration implementado; setas `COL → TSK/PRJ/ORG/IAM` no mapa; linha do contexto; fronteira da porta `TaskDiscussionAccess`; ordem de locks com comentários e o invariante "nada trava `tasks` depois de `comments`". A linha do ADR 0015 entrou na T2.
  - `dependency-rules.md`: seção das bibliotecas de `collaboration`, o que cada fornecedor expõe, lints e o achado do `contains` do Prisma.
  - `business-rules.md`: BR-031 e BR-032 numa seção nova e a linha de status.
  - `authorization.md`: `comment:*` aplicadas, `actions` e ordem de decisão.
  - `multi-tenancy.md`: referências em texto (`embeddedReferences`), casos e bateria.
  - `testing.md`: spec 010 e o passo da jornada.
  - `data-flow.md`: fluxo 3a, comentário com menção (implementado; entrega na 008 planejada).
  - `roadmap.md`: Fase 2 "Em andamento", com a 010 implementada. `specs/README.md`: "Implementada — validação final (T13)".
- **Verificação**: script de links relativos sobre todos os `.md`. Sem links quebrados além dos placeholders dos templates, que já existiam. `prettier --write docs specs` aplicado.

### T13 — 2026-10-14

- **Revisões**: `/review-code` sem bloqueantes; `/security-audit` sem Críticos, Altos ou Médios.
- **Corrigido**:
  - **Importante 1 (revisão)**: o pedaço de texto do template ganhava espaços (`{{ segment.text }}` com recuo, sob `whitespace-pre-wrap`). Agora é `<span>{{ segment.text }}</span>`, e um teste compara o `textContent` exato ("Oi @Caio, veja https://exemplo.com/.Abraço").
  - **Importante 2 (revisão, RNF-07)**: depois de editar, o foco volta ao `article` do comentário (`tabindex="-1"`). Depois de excluir, vai para o composer, ou para o título da seção em só leitura. Testes verificam `document.activeElement`.
  - **Sugestão 4**: teste em `libs/contracts` de que os campos `body` dos schemas de request levam a marca `embeddedReferences`.
  - **Sugestão 3**: o design passou a descrever o comportamento real (token colado é interpretado e conferido pelo servidor).
  - **B1 (auditoria)**: o cursor dos candidatos com id fora do formato UUID era repassado à coluna UUID (500 provável). `decodePosition` passou a exigir UUID e recomeça a busca; há teste.
  - Design revisão 3 registrada.
- **Registrado sem mudança**: os leitores do projeto são recalculados a cada busca de menção (aceitável com o limite de 120 por minuto). O Prisma Client gerado é versionado desde o commit inicial, apesar do `.gitignore` — problema anterior a esta spec.
- **Mutation testing**: 5 mutantes nas correções (espaços, foco ao editar, foco ao excluir, cursor UUID e o `focus-delete`, que sobreviveu até o teste focar o botão antes de confirmar). Todos mortos.
- **Gate final**: `pnpm verify` exit 0 (90 tarefas, 61 do cache com o mesmo hash). `pnpm nx run-many -t integration-test` exit 0 (8 projetos, 244 testes). E2E 19/19 (43,9 s). Aceitação em `acceptance.md`.
