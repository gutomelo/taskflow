# 004 — Tarefas · Requisitos

- **Status**: Aprovado
- **Fase do roadmap**: 1 — MVP (ordem 5, depois de `003-projects`)
- **Bounded contexts**: Tasks (`tasks`, novo); consulta Projects (`projects`) por porta; `projects` avisa `tasks` por porta quando alguém deixa de poder contribuir num projeto (cadeia `organizations → projects → tasks`)
- **Autor / data**: Claude Code (com decisões do usuário) / 2026-10-13
- **Aprovado por / data**: usuário / 2026-10-14

## Objetivo

Permitir que os participantes de um projeto registrem e conduzam o trabalho em tarefas: criar, encontrar, atribuir, priorizar, datar, quebrar em subtarefas, ligar por dependências e mover pelo workflow do projeto — com as regras de conclusão aplicadas pelo sistema, não pela disciplina do time.

## Problema resolvido

Projetos existem (spec 003), mas não há onde colocar o trabalho. A proposta de valor do TaskFlow ("regras reais de trabalho") depende de BR-001 (subtarefas obrigatórias), BR-003 (responsável com acesso), BR-004 (transições), BR-006 (dependências) e BR-008 (concorrência) aplicadas no backend. O quadro Kanban (spec 005) também depende das tarefas.

## Escopo

### Inclui

- Tarefa com título, descrição, status (do workflow do projeto), prioridade, responsável, prazo e identificador `CHAVE-N` (número sequencial por projeto, nunca reutilizado).
- **Subtarefas** como tarefas filhas de um nível só, com a marca "obrigatória" (decisão 1).
- **Um responsável** opcional por tarefa (decisão 2), escolhido entre quem tem papel efetivo `manager` ou `member` no projeto — inclusive owner/admin da organização (decisão 7).
- **Dependências "bloqueada por"** entre tarefas do mesmo projeto, sem ciclos (decisão 3; BR-006).
- Mudança de status **sempre pelas transições do workflow** do projeto (decisão 4; BR-004), com BR-001 e BR-006 na conclusão.
- **Cancelar e reabrir** como ação própria, separada do status (decisão 5).
- **Exclusão definitiva** com confirmação, levando subtarefas e dependências (decisão 6).
- Prioridade em cinco níveis: sem, baixa, média, alta, urgente (decisão 8).
- Lista de tarefas do projeto com filtros; detalhe da tarefa com subtarefas, dependências e as ações permitidas (padrão de capacidades da spec 006).
- Perda de acesso ao projeto desfaz as atribuições na mesma transação (BR-003).
- Interface: aba "Tarefas" no projeto, criação, detalhe em `/o/:slug/projects/:key/tasks/:number`.

### Não inclui

- Quadro Kanban, colunas, ordenação e mover cards (spec 005); configurar status e transições (spec 005).
- Comentários, menções, anexos, histórico de atividades (Fase 2).
- Sprints e backlog (spec 007); notificações (spec 008) — os eventos de conclusão e atribuição ficam no log estruturado nesta spec.
- Vários responsáveis, observadores, etiquetas, estimativas, campos customizados.
- Dependências entre projetos; hierarquia de subtarefas com mais de um nível.
- Lixeira (exclusão reversível).
- Busca textual (Fase 3).

## Requisitos funcionais

| ID    | Requisito                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Prioridade |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RF-01 | Quem tem `task:create` cria uma tarefa num projeto ativo com título (1–200), descrição opcional, prioridade (padrão "sem"), responsável e prazo opcionais. Ela nasce no primeiro status de categoria `todo` e recebe o próximo número do projeto (`CHAVE-N`), nunca reutilizado.                                                                                                                                                                                     | Must       |
| RF-02 | Uma subtarefa é criada informando a tarefa pai, que precisa ser do mesmo projeto e não ser subtarefa (um nível). A marca "obrigatória" pode ser ligada e desligada.                                                                                                                                                                                                                                                                                                  | Must       |
| RF-03 | Quem lê o projeto lista as tarefas por cursor, ordenadas pelo número (mais recentes primeiro), filtrando por status, responsável (uma pessoa por id; ou "eu"/"sem responsável" num filtro separado), prioridade e canceladas (fora por padrão). Por padrão, só tarefas de primeiro nível; subtarefas aparecem no detalhe do pai.                                                                                                                                     | Must       |
| RF-04 | O detalhe (por id ou por `CHAVE-N`) traz os campos, as subtarefas, as dependências nos dois sentidos, as transições permitidas a partir do status atual e as ações que o usuário pode executar (editar, atribuir, cancelar, reabrir, excluir).                                                                                                                                                                                                                       | Must       |
| RF-05 | Quem tem `task:update` edita título, descrição, prioridade, prazo e a marca "obrigatória", informando a versão (BR-008).                                                                                                                                                                                                                                                                                                                                             | Must       |
| RF-06 | Quem tem `task:assign` atribui ou desatribui o responsável, que precisa ter papel efetivo `manager` ou `member` no projeto (BR-003).                                                                                                                                                                                                                                                                                                                                 | Must       |
| RF-07 | Quem tem `task:update` muda o status para um status permitido pela transição do workflow (BR-004). Entrar num status de categoria `done` exige BR-001 e BR-006 e registra a conclusão; sair dele a desfaz.                                                                                                                                                                                                                                                           | Must       |
| RF-08 | Quem tem `task:update` adiciona e remove dependências "bloqueada por" entre tarefas do mesmo projeto; ciclos são recusados (BR-006).                                                                                                                                                                                                                                                                                                                                 | Must       |
| RF-09 | Quem tem `task:update` cancela e reabre uma tarefa. Cancelada sai das listas padrão, não bloqueia o pai (BR-001) nem dependentes (BR-006) e não aceita edição até ser reaberta.                                                                                                                                                                                                                                                                                      | Must       |
| RF-10 | Quem tem `task:delete` (manager: qualquer tarefa; member: as que criou) exclui uma tarefa definitivamente, com suas subtarefas e dependências.                                                                                                                                                                                                                                                                                                                       | Must       |
| RF-11 | Deixar de ter papel efetivo `manager`/`member` num projeto — por qualquer caminho: sair ou ser removido do projeto ou da organização, participação rebaixada a leitor, qualquer mudança de papel na organização cujo papel efetivo resultante não seja manager/member — desfaz as atribuições da pessoa nas tarefas daquele projeto, na mesma transação (BR-003). Quem continua contribuindo (ex.: admin com participação antiga saindo dela) mantém as atribuições. | Must       |
| RF-12 | Projeto arquivado: tarefas só leitura (BR-026 estendida).                                                                                                                                                                                                                                                                                                                                                                                                            | Must       |
| RF-13 | Interface: aba "Tarefas" na área do projeto (lista com filtros, estados de carregamento/vazio/erro, "Nova tarefa"), detalhe em `/o/:slug/projects/:key/tasks/:number` com edição, status pelas transições permitidas, responsável entre os elegíveis, subtarefas, dependências, cancelar/reabrir e excluir. Ações só com capacidade da API.                                                                                                                          | Must       |
| RF-14 | Toda rota nova entra no harness de isolamento (com referências de corpo e query, como `projectId`, `assigneeUserId`, `parentTaskId`, `blockingTaskId`) e na bateria de autorização dentro da organização.                                                                                                                                                                                                                                                            | Must       |

## Requisitos não funcionais

| ID     | Categoria      | Requisito mensurável                                                                                                                                                                                    |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RNF-01 | Segurança      | Decisões no caso de uso com o papel efetivo relido sob lock (padrão das specs 003/006); sem acesso ao projeto ⇒ 404 idêntico a "não existe"; com acesso e sem permissão ⇒ 403 antes de erros de estado. |
| RNF-02 | Integridade    | BR-001, BR-003 e BR-006 nunca violadas sob concorrência (testes de integração com intercalações); números `CHAVE-N` sem repetição sob criação simultânea.                                               |
| RNF-03 | Isolamento     | `organization_id NOT NULL` e FKs compostas em toda tabela nova; tarefas, subtarefas, dependências, status e responsável sempre do mesmo projeto e organização, garantido também pelo banco.             |
| RNF-04 | Desempenho     | Lista de 25 tarefas com número fixo de consultas por página (sem N+1); índices iniciando por `organization_id`.                                                                                         |
| RNF-05 | Abuso          | Limites de criação por usuário, de tarefas por projeto, de subtarefas por tarefa e de dependências por tarefa (valores no design).                                                                      |
| RNF-06 | Acessibilidade | WCAG 2.2 AA nas telas novas (rótulos, foco, teclado, `aria-live`).                                                                                                                                      |

## Regras de negócio

| BR                                          | Aplicação nesta feature                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-001                                      | Pendente = não concluída e não cancelada. Concluir com subtarefa obrigatória pendente ⇒ 422 `TASK_HAS_PENDING_REQUIRED_SUBTASKS` (com os ids). **Esclarecimento proposto (D1 do design)**: a invariante vale sempre — criar ou tornar obrigatória, reabrir ou tirar de `done` uma subtarefa obrigatória de pai concluído, ou reabrir um pai em `done` com obrigatória pendente, é recusado (`PARENT_TASK_COMPLETED` substitui o `TASK_ALREADY_COMPLETED` do texto canônico). |
| BR-002                                      | Matriz da spec 006 (`task:create`, `task:update`, `task:assign`, `task:delete` com `own` para member) sobre o papel efetivo.                                                                                                                                                                                                                                                                                                                                                 |
| BR-003                                      | Responsável com papel efetivo `manager`/`member` (`ASSIGNEE_NOT_PROJECT_MEMBER`, 422). Perder o acesso desfaz a atribuição na mesma transação; nunca bloqueia a remoção (obrigação da spec 003).                                                                                                                                                                                                                                                                             |
| BR-004                                      | Mudança de status só por transição permitida do workflow do projeto (`TRANSITION_NOT_ALLOWED`, 422). A spec 005 reutiliza a mesma regra ao mover cards.                                                                                                                                                                                                                                                                                                                      |
| BR-006                                      | Concluir com dependência pendente ⇒ 422 `TASK_BLOCKED_BY_DEPENDENCIES` (com os ids); ciclo ⇒ 422 `DEPENDENCY_CYCLE`, inclusive o implícito pai × subtarefa obrigatória (D4); só no mesmo projeto; precondição da conclusão (D2).                                                                                                                                                                                                                                             |
| BR-007                                      | Criação, mudança de status, responsável e prazo, cancelamento e exclusão no log estruturado de segurança (desvio da spec 002), só com ids.                                                                                                                                                                                                                                                                                                                                   |
| BR-008                                      | `version` na tarefa; toda alteração informa a versão conhecida.                                                                                                                                                                                                                                                                                                                                                                                                              |
| BR-026                                      | Projeto arquivado ⇒ mutações de tarefa recusadas (`PROJECT_ARCHIVED`, 409).                                                                                                                                                                                                                                                                                                                                                                                                  |
| **BR-028 — Identificador da tarefa** (nova) | `CHAVE-N`: N sequencial por projeto, começando em 1, atribuído na criação e nunca reutilizado (nem depois de exclusão). Imutável, mesmo que a tarefa vire ou deixe de ser subtarefa (não muda de pai nesta spec).                                                                                                                                                                                                                                                            |
| **BR-029 — Tarefa cancelada** (nova)        | Cancelar e reabrir são ações próprias (registram quando e quem), independentes do status. Cancelada: fora das listas padrão, não conta como pendente em BR-001/BR-006, só leitura até reabrir (`TASK_CANCELED`, 409); pode ser excluída.                                                                                                                                                                                                                                     |

## Critérios de aceitação (resumo)

- [ ] CA-01 Manager e member criam tarefas e subtarefas; viewer não; a tarefa nasce no primeiro status `todo`, com `CHAVE-N` sequencial e sem repetição sob criação simultânea.
- [ ] CA-02 Subtarefa só de um nível e do mesmo projeto; BR-001 na conclusão do pai e o esclarecimento da invariante.
- [ ] CA-03 Mudança de status só pelas transições do workflow (BR-004); conclusão registra e desfaz `completedAt`.
- [ ] CA-04 Dependências do mesmo projeto, sem ciclos (inclusive sob concorrência), e BR-006 na conclusão; canceladas não bloqueiam.
- [ ] CA-05 Responsável só com papel efetivo manager/member, incluindo owner/admin; perder o acesso desfaz a atribuição em cada caminho de RF-11 (inclusive "admin com participação viewer rebaixado a member" e "viewer → admin → member"), sob concorrência, sem afetar outra organização, e nunca bloqueia a remoção; quem continua contribuindo mantém as atribuições.
- [ ] CA-06 Cancelar, reabrir e excluir com as permissões e efeitos de BR-029 e RF-10 (member só exclui o que criou).
- [ ] CA-07 Lista com filtros e paginação sem N+1; detalhe com transições e ações vindas da API.
- [ ] CA-08 Projeto arquivado: tarefas só leitura.
- [ ] CA-09 Isolamento: todas as rotas novas no harness (referências de corpo e query incluídas) e na bateria intra-tenant; ids de outra organização ou de outro projeto respondem 404 e nada muda.
- [ ] CA-10 Interface e jornada E2E real: criar tarefa, atribuir, criar subtarefa obrigatória, tentar concluir o pai (recusado), concluir a subtarefa e o pai.

## Casos limite

- Duas pessoas criando tarefas ao mesmo tempo no mesmo projeto: números distintos, sem buracos causados por falhas de unicidade (buracos por exclusão são normais).
- Dependência A bloqueada por B e B bloqueada por A criadas em paralelo: uma das duas é recusada.
- Pai sendo concluído enquanto alguém cria subtarefa obrigatória: uma das duas é recusada.
- Responsável rebaixado a leitor enquanto alguém o atribui: ou a atribuição é recusada, ou é desfeita junto com o rebaixamento.
- Status removido do workflow (spec 005): não ocorre nesta spec; a FK recusa remover status em uso até a 005 decidir.
- Excluir tarefa que bloqueia outras: as dependências somem com ela.
- Tarefa concluída que ganha um bloqueador pendente: permitido (BR-006 é precondição da conclusão, não invariante posterior).

## Restrições e dependências

- Depende das specs 002, 003 e 006 e dos ADRs 0003, 0008, 0012, 0013, 0014 e 0015.
- Obrigações da [spec 003](../003-projects/design.md#transição-para-as-specs-004005-obrigações-registradas). A obrigação 3 (FK do responsável para `project_members`) é **substituída** pela decisão 7: a FK vai para `memberships` e a perda de acesso ao projeto desfaz a atribuição por portas síncronas (registrado no design desta spec e no da 003).

## Perguntas abertas

| #   | Pergunta                                                                                          | Responsável | Decisão                                                                                |
| --- | ------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| 1   | Modelo de subtarefa                                                                               | Usuário     | Tarefas filhas, um nível, com marca "obrigatória"                                      |
| 2   | Quantos responsáveis                                                                              | Usuário     | Um, opcional                                                                           |
| 3   | Dependências entre projetos                                                                       | Usuário     | Só no mesmo projeto                                                                    |
| 4   | Status sem quadro respeita transições?                                                            | Usuário     | Sim, já na 004 (regra em `tasks`, reutilizada pela 005)                                |
| 5   | Como cancelar                                                                                     | Usuário     | Ação cancelar/reabrir, separada do status (BR-029)                                     |
| 6   | Exclusão                                                                                          | Usuário     | Definitiva, com subtarefas e dependências                                              |
| 7   | Owner/admin podem ser responsáveis (D1 da 003)?                                                   | Usuário     | Sim, pelo papel efetivo; FK para `memberships` e portas síncronas desfazem atribuições |
| 8   | Escala de prioridade                                                                              | Usuário     | Sem, baixa, média, alta, urgente (padrão: sem)                                         |
| 9   | Limites, esclarecimento da BR-001, BR-006 como precondição, ciclo implícito, exclusão pelo member | Usuário     | D1–D5 aprovados como recomendados no design                                            |
