# 005 — Kanban · Aceitação

## Cenários

### CA-01 — Quadro do projeto

```gherkin
Dado o projeto WEB com o workflow padrão e tarefas em vários status
Quando um participante abre o quadro
Então vê uma coluna por status, na ordem do workflow
E em cada coluna só tarefas de primeiro nível não canceladas, com subtarefas "feitas/total"
E a ordem é a mesma para todos e entre recargas
E colunas com mais cards que a página mostram "carregar mais"
```

### CA-02 — Reordenar na coluna (BR-009)

```gherkin
Dado a coluna "A fazer" com WEB-1, WEB-2, WEB-3
Quando um member move WEB-3 para depois de WEB-1
Então a coluna fica WEB-1, WEB-3, WEB-2 para todos, e só WEB-3 mudou de posição
E vizinho inexistente, de outra coluna, de outro projeto ou subtarefa responde 422 INVALID_POSITION, com o mesmo corpo
E mover uma subtarefa responde 422 TASK_NOT_A_CARD
E cards com chaves empatadas aceitam um card entre eles (rebalanceando a coluna)
E dois members soltando cards no mesmo ponto ao mesmo tempo mantêm os dois, em ordem determinística
E muitas inserções no mesmo ponto rebalanceiam a coluna sem mudar a ordem visível
```

### CA-03 — Mover entre colunas (BR-004, BR-001, BR-006, BR-010)

```gherkin
Dado o workflow padrão
Quando alguém move um card de "A fazer" direto para "Concluído"
Então recebe 422 TRANSITION_NOT_ALLOWED e nada muda
Quando move para "Em andamento" e depois para "Concluído" com subtarefa obrigatória pendente
Então recebe 422 TASK_HAS_PENDING_REQUIRED_SUBTASKS com os ids, e status e posição continuam os anteriores
E com bloqueadora pendente recebe 422 TASK_BLOCKED_BY_DEPENDENCIES
E com a versão desatualizada recebe 409
```

### CA-04 — Card que muda fora do quadro

```gherkin
Dado o quadro do projeto
Quando uma tarefa é criada, ou movida pelo detalhe, ou reaberta depois de cancelada
Então aparece no fim da coluna do seu status
```

### CA-05 — Configurar o workflow (BR-030)

```gherkin
Dado um gerente do projeto
Quando cria "Em revisão" (em andamento), reordena as colunas e define as transições "Em andamento → Em revisão → Concluído"
Então o quadro mostra a coluna nova na ordem escolhida e só permite os movimentos definidos
E nome repetido (sem diferenciar maiúsculas) responde 409 STATUS_NAME_TAKEN
E mudar a categoria de um status com tarefas (inclusive só canceladas ou subtarefas) responde 409 STATUS_IN_USE; sem tarefas, muda
Quando remove "Em revisão" escolhendo "Em andamento" como destino
Então as tarefas dela (canceladas e subtarefas incluídas) passam a "Em andamento", intercaladas pela posição, com versão incrementada, e a coluna some
E destino de outra categoria responde 422 INVALID_STATUS_TARGET
E remover o único status "a fazer" responde 422 WORKFLOW_NEEDS_TODO_STATUS
E versão do workflow desatualizada responde 409
```

### CA-06 — Permissões e arquivamento

```gherkin
Dado um projeto com manager, member e viewer participantes
Então o member move cards mas recebe 403 ao configurar o workflow
E o viewer vê o quadro e recebe 403 ao mover
E com o projeto arquivado, mover e configurar respondem 409 PROJECT_ARCHIVED, depois do 403
```

### CA-07 — Concorrência workflow × quadro (RNF-02)

```gherkin
Dado alguém movendo cards
Quando o gerente remove a coluna de destino ou a transição usada ao mesmo tempo
Então o movimento acontece antes (e a tarefa é migrada com as demais) ou é recusado, nunca deixa tarefa em status removido nem passa por transição removida
```

### CA-08 — Isolamento e autorização

```gherkin
Dado as organizações A e B e projetos P1 e P2 em A
Quando as rotas do quadro e do workflow são chamadas sob o prefixo de A com ids de B ou de P2 (caminho, corpo, query, listas `statusIds[]` e `transitions[]`, `moveTasksToStatusId`)
Então respondem 404 ou 422 com o código esperado, sem ids alheios nas respostas e sem efeito
E quem não participa recebe o mesmo corpo de "não existe"; participante sem permissão recebe 403 antes de erros de estado
```

### CA-09 — Interface

```gherkin
Dado o quadro aberto
Quando o usuário arrasta um card ou usa "Mover para…" / "Para cima" / "Para baixo" pelo teclado
Então o card muda de lugar, o resultado é anunciado e o foco volta ao card
E um movimento recusado volta o card à posição anterior com a mensagem da regra
E as ações aparecem só com capacidade da API
```

### CA-10 — Jornada

```gherkin
Dado um projeto com tarefas e um participante member
Quando o gerente cria a coluna "Em revisão" e as transições
E move cards pelo quadro até "Concluído", com a recusa da conclusão do pai com subtarefa obrigatória pendente
Então o quadro final reflete status e ordem
```

## Testes obrigatórios

- [x] Domínio: chave de posição (propriedades), BR-030
- [x] Casos de uso com fakes: quadro, movimento, workflow, ordem de decisão
- [x] Integração: backfill e restrições, collation e índice funcional (catálogo), concorrência, rebalanceamento, reatribuição, harness (listas e aninhados) e baterias
- [x] HTTP: contratos, 400/403/404/409/422/429, OpenAPI
- [x] Frontend: quadro (arrastar e teclado), configuração do workflow
- [x] E2E: jornada real do quadro; jornadas existentes verdes

## Evidências de validação

| Critério | Evidência (comando + resultado)                                                                                                                                                                                                                                                                                                                                                                                                                                         | Data       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| CA-01    | `board.use-cases.spec.ts` ("one column per status in workflow order, only top-level not canceled cards, in rank order", "pages a column by cursor…"); `tasks-persistence.integration.spec.ts` ("pages a column by (rank, id)…", "counts subtasks per card…"); `board.page.spec.ts` (colunas, subtarefas, "loads more cards…")                                                                                                                                           | 2026-10-14 |
| CA-02    | `rank.spec.ts` (10 testes de propriedade); `board.use-cases.spec.ts` ("reorders within the column: only the moved card changes…", ordem de decisão com `INVALID_POSITION`/`TASK_NOT_A_CARD`, "B2: tied ranks…", "long keys trigger a rebalance…"); `board-composition.integration.spec.ts` ("BR-009: two cards dropped at the same point at the same time…", "B2: cards with tied ranks…", "a rebalance and a concurrent creation never lose a card")                   | 2026-10-14 |
| CA-03    | `board.use-cases.spec.ts` ("BR-004: another column is a status change…; refused moves change nothing", "BR-001/BR-006: entering done keeps status and position when refused", 409 na ordem de decisão); `tasks-router.spec.ts` ("POST /tasks/{id}/move…")                                                                                                                                                                                                               | 2026-10-14 |
| CA-04    | `board.use-cases.spec.ts` ("creation, transition from the detail and reopening")                                                                                                                                                                                                                                                                                                                                                                                        | 2026-10-14 |
| CA-05    | `workflow-editing.spec.ts` (BR-030); `workflow.use-cases.spec.ts` (criar, renomear/categoria só sem tarefas, remover com reatribuição na mesma transação, reordenar e transições); `projects-persistence.integration.spec.ts` (`STATUS_IN_USE`, `STATUS_NAME_TAKEN`); `board-composition.integration.spec.ts` ("removing a status with tasks reassigns all of them…, keeping the relative order"); `projects-router.spec.ts` (400/404/409); `workflow-settings.spec.ts` | 2026-10-14 |
| CA-06    | `board.use-cases.spec.ts` e `workflow.use-cases.spec.ts` (ordens de decisão com 403 antes de `PROJECT_ARCHIVED`); `projects-router.spec.ts` ("a participant member gets 403 on every workflow edit"); baterias `projects-authorization` e `tasks-authorization` (403 antes de erros de estado)                                                                                                                                                                          | 2026-10-14 |
| CA-07    | `board-composition.integration.spec.ts` ("CA-07: removing the target column while a card moves into it…", "CA-07: replacing the transitions waits for a move holding the project…", categoria × criação)                                                                                                                                                                                                                                                                | 2026-10-14 |
| CA-08    | `organizations-isolation`, `projects-authorization` e `tasks-authorization` (`*.integration.spec.ts`) com as 8 rotas novas em `isolation-cases.ts`; `route-coverage.spec.ts` (variantes para listas e aninhados); "IDOR between projects…, even for the owner"                                                                                                                                                                                                          | 2026-10-14 |
| CA-09    | `board.page.spec.ts` (teclado com anúncio e foco, arrastar, recusa com reversão, recarga em dado velho, capacidade `move`); `workflow-settings.spec.ts` ("CA-09: without board:configure the section is absent")                                                                                                                                                                                                                                                        | 2026-10-14 |
| CA-10    | `apps/web-e2e/src/projects-journey.spec.ts` (passo "spec 005")                                                                                                                                                                                                                                                                                                                                                                                                          | 2026-10-14 |
| Gate     | `pnpm verify`: exit 0, 78 tarefas (62 do cache do Nx, mesmo hash de entradas); `pnpm test:integration`: exit 0, 7 projetos, **218 testes** (identity 50, organizations 33, shared 33, projects 24, worker 9, tasks 24, api 45); E2E Playwright **19/19** (41,6 s) contra `taskflow_e2e`                                                                                                                                                                                 | 2026-10-14 |
| Revisões | `/review-code`: sem bloqueantes; 1 Importante (rebalanceamento antes das regras) corrigido com teste e mutante morto; sugestões aplicadas (409 no empate residual, lotes de colunas, recarga do quadro e do fluxo em dado velho, casts do harness) ou registradas (revisão 3 do design). `/security-audit`: sem Críticos/Altos/Médios; o Baixo B1 é o mesmo achado, corrigido                                                                                           | 2026-10-14 |

## Definição de concluído

- [x] CA-01 a CA-10 comprovados por testes executados
- [x] `pnpm verify`, `pnpm test:integration` e E2E passando
- [x] `/review-code` sem bloqueantes e `/security-audit` sem Críticos/Altos abertos
- [x] ADRs 0007 e 0016, documentação, regras de negócio, design da 004 e roadmap atualizados
