# 005 — Kanban · Requisitos

- **Status**: Aprovado
- **Fase do roadmap**: 1 — MVP (ordem 6, depois de `004-tasks`)
- **Bounded contexts**: Tasks (`tasks`: o quadro é uma visão das tarefas — posição do card, leitura do quadro e movimento; D1 do design, ADR 0016); Projects (`projects`: configuração do workflow — status e transições), que pede a `tasks` por porta para contar e reatribuir tarefas de um status (cadeia `organizations → projects → tasks`). O contexto Boards fica adiado
- **Autor / data**: Claude Code (com decisões do usuário) / 2026-10-14
- **Aprovado por / data**: usuário / 2026-10-14

## Objetivo

Dar a cada projeto um quadro Kanban em que o time vê e move o trabalho: colunas que são os status do workflow, cards ordenados de forma estável e movimentos que respeitam as mesmas regras de conclusão das tarefas — e permitir ao gerente adaptar o workflow (status e transições) ao processo do time.

## Problema resolvido

As tarefas (spec 004) só aparecem em lista e mudam de status pelo detalhe; o workflow é fixo ("A fazer", "Em andamento", "Concluído"). Times que trabalham com Kanban precisam ver o fluxo por colunas, priorizar pela ordem dos cards e ter etapas próprias (ex.: "Em revisão"). A proposta de valor exige que mover um card aplique BR-001, BR-004 e BR-006 no backend, como a mudança de status já faz.

## Escopo

### Inclui

- **Um quadro por projeto** (decisão 1): cada status do workflow é uma coluna, na ordem dos status.
- **Cards**: tarefas de primeiro nível não canceladas (decisão 4), com chave, título, prioridade, responsável, prazo e contagem de subtarefas (concluídas/total).
- **Ordem determinística** dos cards na coluna (BR-009) por chave fracionária própria no domínio de `tasks` (decisão 8; ADR 0007 passa a Aceito).
- **Mover card**: reordenar na mesma coluna ou mover para outra coluna (= mudar o status pela transição do workflow, BR-004, com BR-001/BR-006 ao entrar em `done`), numa única transação (BR-010).
- **Configurar o workflow** (decisão 2), só gerente (`board:configure`, decisão 7): criar, renomear, reordenar e remover status (remover exige migrar as tarefas do status para outro); editar as transições permitidas.
- **Categoria** de um status só muda se ele não tiver tarefas (decisão 3; `STATUS_IN_USE`).
- Projeto arquivado: quadro e workflow só leitura (BR-026).
- Atualização **sem tempo real** (decisão 5): o quadro recarrega após cada movimento próprio e em "Atualizar"; conflito recarrega a coluna com aviso.
- Interface: aba "Quadro" no projeto (`/o/:slug/projects/:key/board`) com arrastar e soltar **e alternativa por teclado**; tela de configuração do workflow nas configurações do projeto.

### Não inclui

- Tempo real (Socket.IO, Fase 2); polling.
- Vários quadros por projeto, filtros salvos, raias (swimlanes), limites de WIP (decisão 6), cores e ícones de coluna.
- Subtarefas e canceladas como cards (aparecem no detalhe da tarefa e na lista com filtro).
- Templates de workflow entre projetos, workflow por tipo de tarefa, automações.
- Sprints no quadro (spec 007).

## Requisitos funcionais

| ID    | Requisito                                                                                                                                                                                                                                                                                                                                 | Prioridade |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RF-01 | Quem lê o projeto vê o quadro: uma coluna por status (na ordem do workflow, com nome e categoria) e, em cada coluna, os cards de tarefas de primeiro nível não canceladas, em ordem estável. Colunas grandes carregam por página ("carregar mais").                                                                                       | Must       |
| RF-02 | Quem tem `task:update` reordena um card dentro da coluna informando o vizinho (antes ou depois); a posição persiste e é a mesma para todos (BR-009).                                                                                                                                                                                      | Must       |
| RF-03 | Quem tem `task:update` move um card para outra coluna, numa posição; o movimento é a mudança de status da tarefa pelas transições do workflow (BR-004) e, ao entrar em `done`, aplica BR-001 e BR-006. Status e posição mudam juntos ou nada muda (BR-010). Movimento recusado devolve o card à posição anterior com a mensagem da regra. | Must       |
| RF-04 | O quadro expõe as transições do workflow (para onde cada coluna pode mandar seus cards) e as ações do usuário no quadro — mover e configurar (padrão de capacidades da spec 006).                                                                                                                                                         | Must       |
| RF-05 | Gerente (`board:configure`) cria status com nome e categoria; o status entra no fim do workflow, sem transições.                                                                                                                                                                                                                          | Must       |
| RF-06 | Gerente renomeia e reordena status (ordem das colunas).                                                                                                                                                                                                                                                                                   | Must       |
| RF-07 | Gerente muda a categoria de um status só se ele não tiver tarefas (`STATUS_IN_USE`, 409).                                                                                                                                                                                                                                                 | Must       |
| RF-08 | Gerente remove um status; se ele tiver tarefas, informa outro status **da mesma categoria** para onde elas vão; a migração e a remoção acontecem juntas. O workflow nunca fica sem status de categoria `todo`.                                                                                                                            | Must       |
| RF-09 | Gerente define o conjunto de transições permitidas (pares origem → destino entre status distintos do projeto).                                                                                                                                                                                                                            | Must       |
| RF-10 | Projeto arquivado: mover cards e configurar o workflow são recusados (`PROJECT_ARCHIVED`, 409); a leitura continua.                                                                                                                                                                                                                       | Must       |
| RF-11 | Uma tarefa que muda de status fora do quadro (detalhe da tarefa) aparece no fim da nova coluna; uma tarefa criada aparece no fim da coluna inicial; uma cancelada reaberta aparece no fim da coluna do seu status.                                                                                                                        | Must       |
| RF-12 | Interface: aba "Quadro" com colunas, cards, arrastar e soltar com alternativa por teclado (mover para coluna e para cima/baixo por ações acessíveis), estados de carregamento/vazio/erro, "Atualizar"; configuração do workflow (status e matriz de transições) em "Configurações" do projeto. Ações só com capacidade da API.            | Must       |
| RF-13 | Toda rota nova entra no harness de isolamento (com referências de caminho, corpo e query) e na bateria de autorização dentro da organização.                                                                                                                                                                                              | Must       |

## Requisitos não funcionais

| ID     | Categoria      | Requisito mensurável                                                                                                                                                                                                            |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RNF-01 | Segurança      | Papel efetivo relido sob lock em toda escrita; sem acesso ao projeto ⇒ 404 idêntico a "não existe"; com acesso e sem permissão ⇒ 403 antes de erros de estado.                                                                  |
| RNF-02 | Integridade    | BR-001, BR-004, BR-006 e BR-009 nunca violadas sob concorrência: movimentos simultâneos não perdem cards nem criam ordem ambígua; editar o workflow enquanto alguém move cards é serializado.                                   |
| RNF-03 | Desempenho     | Carregar o quadro em número de consultas limitado pelo teto de status (uma por coluna, no máximo 20) e independente do número de cards; movimento altera **uma** posição (sem reescrever a coluna), salvo rebalanceamento raro. |
| RNF-04 | Isolamento     | Posição é coluna de `tasks` (sem tabela nova); vizinhos, status e listas de status só do mesmo projeto e organização, verificados no caso de uso e, onde possível, pelas FKs compostas.                                         |
| RNF-05 | Abuso          | Limites de movimentos e de edições de workflow por usuário; teto de status por projeto e de cards por página de coluna (valores no design).                                                                                     |
| RNF-06 | Acessibilidade | WCAG 2.2 AA: arrastar e soltar com alternativa completa por teclado, anúncios `aria-live` do resultado, foco preservado no card movido.                                                                                         |

## Regras de negócio

| BR                                        | Aplicação nesta feature                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-001                                    | Mover para coluna de categoria `done` aplica a mesma verificação da conclusão (núcleo de `TransitionTask`).                                                                                                                                                                                                                                                 |
| BR-002                                    | Mover = `task:update`; configurar workflow = `board:configure` (matriz da spec 006).                                                                                                                                                                                                                                                                        |
| BR-004                                    | Mover entre colunas só por transição permitida (`TRANSITION_NOT_ALLOWED`, 422). Mover na mesma coluna é só reordenação. As transições passam a ser configuráveis (RF-09).                                                                                                                                                                                   |
| BR-006                                    | Mover para `done` com bloqueadora pendente ⇒ `TASK_BLOCKED_BY_DEPENDENCIES` (422, com os ids).                                                                                                                                                                                                                                                              |
| BR-008                                    | Mover informa a versão da tarefa; configurar o workflow informa a versão do workflow.                                                                                                                                                                                                                                                                       |
| BR-009                                    | Ordem total `(posição, id)` na coluna; o cliente informa o vizinho, o servidor calcula a chave; vizinho inexistente ou de outra coluna ⇒ `INVALID_POSITION` (422).                                                                                                                                                                                          |
| BR-010                                    | Status e posição (ambos em `tasks`) na mesma transação; remover status e reatribuir as tarefas na mesma transação.                                                                                                                                                                                                                                          |
| BR-026                                    | Projeto arquivado: quadro e workflow só leitura.                                                                                                                                                                                                                                                                                                            |
| **BR-030 — Workflow configurável** (nova) | Nomes de status únicos no projeto (sem diferenciar maiúsculas), 1–40 caracteres; ao menos um status `todo` sempre (o primeiro `todo` pela ordem é o inicial); teto de status por projeto; categoria só muda em status sem tarefas; remover exige destino da mesma categoria; transições ligam status distintos do mesmo projeto. Erros e códigos no design. |

## Critérios de aceitação (resumo)

- [ ] CA-01 Quadro do projeto com uma coluna por status e cards de primeiro nível não cancelados, em ordem estável e igual para todos.
- [ ] CA-02 Reordenar na coluna persiste; vizinho inválido ⇒ `INVALID_POSITION`; movimentos simultâneos não perdem cards.
- [ ] CA-03 Mover para outra coluna muda o status pelas transições (BR-004); BR-001/BR-006 ao entrar em `done`; recusado ⇒ nada muda.
- [ ] CA-04 Tarefa movida pelo detalhe ou criada aparece no fim da coluna.
- [ ] CA-05 Gerente cria, renomeia, reordena e remove status (com migração para status da mesma categoria) e edita transições; categoria só muda em status vazio; nunca fica sem `todo`.
- [ ] CA-06 Member move cards mas não configura; viewer só vê; projeto arquivado só leitura.
- [ ] CA-07 Editar o workflow enquanto alguém move cards nunca deixa tarefa em status removido nem em transição proibida.
- [ ] CA-08 Isolamento e autorização: rotas novas no harness e na bateria; ids de outra organização ou de outro projeto ⇒ 404 sem efeito.
- [ ] CA-09 Interface: arrastar e soltar e alternativa por teclado; mensagens das regras; ações só com capacidade da API.
- [ ] CA-10 Jornada E2E real: configurar uma coluna nova, mover cards entre colunas e recusa de conclusão com subtarefa obrigatória pendente.

## Casos limite

- Dois usuários soltam cards na mesma posição ao mesmo tempo: ambos persistem, em ordem determinística.
- Card movido enquanto o gerente remove a coluna de destino: o movimento é recusado (status inexistente) ou acontece antes e a tarefa é migrada junto com as demais.
- Card movido enquanto o gerente remove a transição usada: o movimento é recusado ou acontece antes da remoção, nunca depois.
- Remover o único status `todo`: recusado.
- Status sem transições de saída: permitido (as tarefas ficam nele até o gerente criar uma transição); a interface avisa.
- Muitas inserções no mesmo ponto: as chaves crescem até um limite e a coluna é rebalanceada sem mudar a ordem visível.
- Tarefa cancelada some do quadro e volta ao ser reaberta, no fim da coluna do seu status.
- Coluna com milhares de cards: paginação por coluna; mover para posição fora da página carregada usa o vizinho visível.

## Restrições e dependências

- Specs/ADRs: 003 (workflow em `projects`), 004 (núcleo de `TransitionTask`, obrigações "Transição para as specs 005/007/008"), 006 (matriz, `board:configure`), ADR 0007 (ordenação; decidido aqui), 0008, 0013, 0014, 0015.
- Sem dependência nova: ranking próprio (decisão 8).
- Prisma 7 e PostgreSQL ≥ 15; collation binária `"C"` na coluna de posição.

## Perguntas abertas

| #   | Pergunta                          | Responsável | Decisão                                                         |
| --- | --------------------------------- | ----------- | --------------------------------------------------------------- |
| 1   | Um ou vários quadros por projeto? | Usuário     | Um por projeto; coluna = status (2026-10-14)                    |
| 2   | O que configurar no workflow?     | Usuário     | Status (criar, renomear, reordenar, remover) e transições       |
| 3   | Categoria de status em uso?       | Usuário     | Só muda em status sem tarefas (`STATUS_IN_USE`)                 |
| 4   | Quais tarefas são cards?          | Usuário     | Primeiro nível, não canceladas                                  |
| 5   | Atualização entre usuários?       | Usuário     | Sem tempo real nesta spec (Socket.IO na Fase 2)                 |
| 6   | Limite de WIP?                    | Usuário     | Fora desta spec                                                 |
| 7   | Quem move e quem configura?       | Usuário     | Matriz atual: mover `task:update`; configurar `board:configure` |
| 8   | Ranking próprio ou biblioteca?    | Usuário     | Função própria no domínio (de `tasks`, pelo D1 do design)       |
