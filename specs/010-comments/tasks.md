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
| T5  | `collaboration/application`: `GetComment`, `ListComments`, `CreateComment`, `EditComment`, `DeleteComment`, `ListMentionCandidates`; portas `TaskDiscussionAccess` e `CollaborationUserDirectory` ("Ex-membro"); erros com os mesmos códigos dos reaproveitados; ordens de decisão (404 único por comentário; excluir sem checagem de estado); limites; eventos; fakes | T1, T4     | testes com fakes (CA-01..CA-06)                                          | [ ]    |
| T6  | Composição em `apps/api` (`task-discussion-access.adapter.ts`, `collaboration-user-directory.adapter.ts`, `collaboration.module.ts`, `ApiModules.collaboration`, ordem de montagem); integração concorrente: comentar × cancelar, × excluir tarefa, × perda de acesso do mencionado; cascata da organização                                                            | T3, T5     | `*.integration.spec.ts` (CA-07)                                          | [ ]    |

## Bloco C — HTTP, isolamento e autorização

| ID  | Tarefa                                                                                                                                                                                                                                                                                     | Depende de | Verificação                             | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------- | ------ |
| T7  | Contratos (`comments.contract.ts`, `body` com `.meta({ embeddedReferences: 'mentions' })`), router (6 rotas), mapeamento de erros (paridade), limites (`collaboration.comments.write.user.hour`, `collaboration.mentions.read.user.minute`), OpenAPI (tag Comments)                        | T6         | testes do router; `openapi.spec`        | [ ]    |
| T8  | Harness: `inputReferences` reconhece `embeddedReferences` e exige a variante `body.mentions` (teste unitário de falha); casos das 6 rotas (`refused` 422 `INVALID_MENTION` para usuário de B e membro sem acesso); baterias de autorização e isolamento comparando o corpo inteiro dos 404 | T7         | `route-coverage.spec`; baterias (CA-08) | [ ]    |

## Bloco D — Frontend e jornada

| ID  | Tarefa                                                                                                                                                                                                                                                             | Depende de | Verificação                                                                       | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------------------------------------- | ------ |
| T9  | Seção "Comentários" no detalhe da tarefa: `CommentsStore`, segmentação pura (texto, menção, link, quebra; `<bdi>`, `dir="auto"`, links via `URL`), lista, carregar anteriores, "Ex-membro", editar, excluir com confirmação (também em só leitura), "mostrar mais" | T7         | testes de componente e da segmentação (cargas de XSS e bidi, paridade de menções) | [ ]    |
| T10 | Composer com menções: intervalos `{start, end, userId}`, `serialize`/`deserialize` puros, combobox acessível com debounce, contador serializado                                                                                                                    | T9         | testes das funções puras e de componente (teclado)                                | [ ]    |
| T11 | E2E real (continua a jornada de projetos e tarefas): comentar com menção, editar, excluir, tarefa cancelada sem composer e com excluir                                                                                                                             | T10        | Playwright no banco descartável (CA-10)                                           | [ ]    |

## Bloco E — Documentação e validação

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                                                                                                                        | Depende de | Verificação                                                           | Status |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------- | ------ |
| T12 | Docs: `bounded-contexts.md` (Collaboration implementado; setas `COL → TSK/PRJ/IAM`; fronteira `collaboration × tasks`; ordem de locks estendida e invariante), `dependency-rules.md` (bibliotecas e lints), `business-rules.md` (BR-031, BR-032; exceção de exclusão em BR-026/BR-029), `authorization.md` (`comment:*` aplicadas), `multi-tenancy.md` (referências em texto), `testing.md`, `data-flow.md`; índice e roadmap | T1–T11     | verificação de links                                                  | [ ]    |
| T13 | `/review-code` e `/security-audit`; correções; gate final                                                                                                                                                                                                                                                                                                                                                                     | T12        | sem bloqueantes / sem Críticos-Altos; `pnpm verify`, integração e E2E | [ ]    |

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
