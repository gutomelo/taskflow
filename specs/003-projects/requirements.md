# 003 — Projetos · Requisitos

- **Status**: Aprovado
- **Fase do roadmap**: 1 — MVP (ordem 4, depois de `006-permissions`)
- **Bounded contexts**: Projects (`projects`, novo); consulta Organizations (`organizations`) e Identity & Access (`identity`) por portas; `organizations` chama `projects` por porta para propagar remoção e rebaixamento (obrigações da spec 006)
- **Autor / data**: Claude Code (com decisões do usuário) / 2026-10-13
- **Aprovado por / data**: usuário / 2026-10-13

## Objetivo

Permitir que uma organização organize o trabalho em projetos: criar, encontrar, configurar e arquivar projetos, e decidir quem participa de cada um e com que papel, aplicando a matriz de projeto e o papel efetivo da spec 006. Cada projeto já nasce com o workflow padrão de que as tarefas (spec 004) vão precisar.

## Problema resolvido

Hoje a organização existe, mas não há onde colocar trabalho. A matriz de projeto e o papel efetivo (BR-023) estão definidos e testados como funções puras, mas não se aplicam a nada. As specs 004 (tarefas) e 005 (Kanban) dependem de projetos com participantes, papel efetivo, chave para identificar tarefas e um workflow de status.

## Escopo

### Inclui

- Projeto com nome, descrição opcional e **chave curta imutável**, única na organização (decisão 2; BR-025).
- Criação por quem tem `project:create` (BR-024). O criador member vira `manager` do projeto; owner/admin não viram participantes explícitos, porque já gerenciam todos os projetos (D1).
- Lista de projetos visíveis ao usuário: owner/admin veem todos, os demais só aqueles de que participam (BR-023). Ativos por padrão; arquivados sob filtro.
- Leitura de um projeto (por id e por chave) com o papel efetivo e as capacidades de projeto do usuário (padrão da spec 006).
- Edição de nome e descrição com versão (BR-008).
- **Arquivar e restaurar** (decisão 3). Projeto arquivado fica somente leitura (BR-026).
- Participantes: listar; adicionar membros da organização; alterar papel; remover; sair do projeto (decisão 4; BR-027).
- **Workflow padrão fixo** criado com o projeto: "A fazer", "Em andamento", "Concluído", com transições de ida e volta. Leitura apenas; a configuração fica para a spec 005 (decisão 1).
- Obrigações da spec 006: configuração lida na mesma transação, sem privilégio adormecido (FK em cascata, teto na gravação, rebaixamento propagado), preparação para RLS, harness cobrindo referências no corpo.
- Interface: lista e criação de projetos na área da organização, visão geral, configurações e participantes do projeto.

### Não inclui

- Tarefas, quadros, sprints, comentários (specs 004, 005, 007, Fase 2).
- Configurar status e transições (spec 005).
- Excluir projeto definitivamente (backlog, junto com a exclusão de organização).
- Convidar por e-mail direto para o projeto (decisão 4): só membros da organização entram.
- Regra de "último manager" (decisão 4): owner/admin da organização sempre gerenciam todos os projetos.
- Equipes, papéis customizáveis, projetos públicos para a organização inteira.
- Auditoria transacional (BR-007 segue com o desvio registrado na spec 002: log estruturado).

## Requisitos funcionais

| ID    | Requisito                                                                                                                                                                                                                                                                                                                                                                   | Prioridade |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RF-01 | Quem tem `project:create` na organização (BR-024, configuração lida no momento da criação) cria um projeto com nome (2–80), chave (BR-025) e descrição opcional (até 2000 caracteres). O criador que é member da organização vira participante `manager` (owner/admin não são gravados, D1), e o workflow padrão é criado na mesma transação.                               | Must       |
| RF-02 | A lista de projetos devolve só os projetos visíveis ao usuário (owner/admin: todos; demais: os que participam), paginada por cursor e ordenada por nome. Por padrão, só os ativos; os arquivados vêm com filtro explícito.                                                                                                                                                  | Must       |
| RF-03 | Ler um projeto, por id ou por chave, devolve nome, chave, descrição, estado, versão, o papel efetivo do usuário e as capacidades de projeto (permissões efetivas). Projeto inexistente, de outra organização ou sem acesso responde 404 sem distinção.                                                                                                                      | Must       |
| RF-04 | Quem tem `project:update` altera nome e descrição informando a versão (BR-008). A chave não muda.                                                                                                                                                                                                                                                                           | Must       |
| RF-05 | Quem tem `project:archive` arquiva e restaura o projeto informando a versão. O projeto arquivado sai da lista padrão e fica somente leitura (BR-026).                                                                                                                                                                                                                       | Must       |
| RF-06 | Quem tem `project:read` lista os participantes (nome, e-mail, papel no projeto, papel efetivo), com as ações que o usuário atual pode executar sobre cada um (alterar papel para quais papéis, remover).                                                                                                                                                                    | Must       |
| RF-07 | Quem tem `project-member:manage` adiciona um membro da organização ao projeto com um papel que respeita o teto do papel dele na organização (BR-023, BR-027). Quem não é membro da organização, ou já participa, é recusado.                                                                                                                                                | Must       |
| RF-08 | Quem tem `project-member:manage` altera o papel de um participante (teto aplicado, com versão) e o remove. Qualquer participante sai do projeto sozinho.                                                                                                                                                                                                                    | Must       |
| RF-09 | Todo projeto tem o workflow padrão (status "A fazer", "Em andamento", "Concluído", com categorias `todo`, `in_progress` e `done`, e transições de ida e volta entre vizinhos), que qualquer participante consulta.                                                                                                                                                          | Must       |
| RF-10 | Remover alguém da organização, ou a pessoa sair, apaga suas participações em projetos na mesma transação. Rebaixar alguém a viewer na organização rebaixa suas participações a `viewer` na mesma operação (BR-027).                                                                                                                                                         | Must       |
| RF-11 | A área da organização mostra a lista de projetos (com filtro de arquivados) e a criação, que sugere a chave a partir do nome. Cada projeto tem visão geral (nome, chave, descrição, workflow, estado), configurações (editar, arquivar, restaurar) e participantes. Ações aparecem só com a capacidade correspondente; projeto arquivado mostra o estado e esconde edições. | Must       |
| RF-12 | Toda rota nova entra no harness de isolamento da spec 006 com variantes para cada referência a outro recurso, inclusive as que vão no corpo da requisição (obrigação 6 da spec 006).                                                                                                                                                                                        | Must       |

## Requisitos não funcionais

| ID     | Categoria      | Requisito mensurável                                                                                                                                                                                        |
| ------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RNF-01 | Segurança      | Toda decisão é tomada no caso de uso com o papel efetivo relido na mesma transação; capacidades e ações são só dica (padrão da spec 006). Sem acesso ao projeto ⇒ 404; com acesso e sem permissão ⇒ 403.    |
| RNF-02 | Segurança      | Nenhum caminho grava participação acima do teto nem deixa participação de quem saiu da organização (verificado por testes de integração e por restrição do banco).                                          |
| RNF-03 | Isolamento     | Toda tabela nova tem `organization_id NOT NULL` e FKs compostas `(organization_id, …)` (ADR 0014); o harness cobre 100% das rotas novas e suas referências.                                                 |
| RNF-04 | Concorrência   | Alterações simultâneas no mesmo projeto ou participante: uma vence, a outra recebe 409 (BR-008). Mudança de papel na organização e mudança no projeto nunca deixam o teto violado, em nenhuma intercalação. |
| RNF-05 | Desempenho     | Lista de projetos e de participantes (25 itens) com número fixo de consultas por página, sem N+1; índices iniciando por `organization_id`.                                                                  |
| RNF-06 | Abuso          | Limites de criação de projetos por usuário e de projetos por organização, e de participantes por projeto (valores no design).                                                                               |
| RNF-07 | Acessibilidade | WCAG 2.2 AA nas telas novas (rótulos, foco, teclado, `aria-live` para feedback), como nas specs 001 e 002.                                                                                                  |

## Regras de negócio

| BR                                                      | Aplicação nesta feature                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-004                                                  | Só a parte "workflow padrão criado com o projeto". Validar transições ao mover tarefas é da spec 005.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| BR-007                                                  | Criação, arquivamento, restauração e mudanças de participação são relevantes. Seguem o desvio da spec 002: eventos no log estruturado de segurança, só com ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| BR-008                                                  | Projeto e participação têm `version`; edição, arquivamento, restauração, mudança de papel e remoção exigem a versão conhecida.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| BR-023                                                  | Papel efetivo aplicado a cada leitura e decisão; visibilidade da lista.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| BR-024                                                  | `project:create` resolvido com a configuração da organização lida na mesma transação da criação.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **BR-025 — Chave do projeto** (nova)                    | 2 a 10 caracteres, letras maiúsculas sem acento e dígitos, começando por letra (`[A-Z][A-Z0-9]{1,9}`); única na organização, incluindo projetos arquivados; definida na criação e imutável. Erros: `PROJECT_KEY_TAKEN` (409), `INVALID_PROJECT_KEY` (400).                                                                                                                                                                                                                                                                                                                                                                   |
| **BR-026 — Projeto arquivado é somente leitura** (nova) | Arquivado não aceita edição nem novas participações ou mudanças de papel (`PROJECT_ARCHIVED`, 409); continua legível por quem tem acesso. Remover participante e sair continuam permitidos (reduzir acesso é sempre seguro). Só a restauração devolve a escrita. As specs 004/005 estendem a regra a tarefas e quadros.                                                                                                                                                                                                                                                                                                      |
| **BR-027 — Participação no projeto** (nova)             | Só membros da organização participam. O papel gravado nunca passa do teto (viewer na organização ⇒ só `viewer`). Sair ou ser removido da organização apaga as participações; ser rebaixado a viewer na organização rebaixa as participações a `viewer`, e promover de volta não as restaura. Participar duas vezes é recusado (`ALREADY_A_PROJECT_MEMBER`, 409). Owner/admin da organização não são adicionados como participantes (`ALREADY_MANAGES_ALL_PROJECTS`, 422): já gerenciam todos os projetos, e uma participação gravada só passaria a valer depois de um rebaixamento (D1). Sair do projeto é sempre permitido. |

## Critérios de aceitação (resumo)

- [x] CA-01 Owner/admin sempre criam projeto; member cria só com a configuração ligada; viewer nunca cria. O criador member vira `manager` (owner/admin não são gravados) e o projeto nasce com o workflow padrão.
- [x] CA-02 Chave inválida ⇒ 400; chave repetida na organização (mesmo de projeto arquivado) ⇒ 409; a mesma chave em outra organização é aceita; não há como alterar a chave.
- [x] CA-03 Member/viewer só listam e leem os projetos de que participam; owner/admin veem todos; para quem não participa, toda rota do projeto responde 404 com o mesmo corpo de um projeto inexistente (por id e por chave); participante sem permissão recebe 403 antes de qualquer erro de estado.
- [x] CA-04 A leitura do projeto traz papel efetivo e capacidades coerentes com a matriz da spec 006 (ex.: viewer da organização com participação `manager` gravada antes de ser rebaixado aparece como `viewer`).
- [x] CA-05 Editar e arquivar exigem a permissão e a versão; arquivado recusa edição e novas participações (409 `PROJECT_ARCHIVED`), sai da lista padrão e volta com restaurar.
- [x] CA-06 Adicionar participante: só membro da organização, papel dentro do teto, sem duplicidade, nunca owner/admin; viewer da organização não pode virar `manager` nem `member`.
- [x] CA-07 Alterar papel e remover exigem `project-member:manage` e versão; qualquer participante sai sozinho; as ações por participante vêm da API; o manager de um projeto não altera nem remove quem só participa de outro projeto (404, outro projeto intacto).
- [x] CA-08 Remover alguém da organização apaga suas participações; rebaixá-lo a viewer rebaixa as participações; promovê-lo de volta não as restaura (BR-027), inclusive sob concorrência com uma mudança no projeto.
- [x] CA-09 Toda rota nova tem caso de isolamento, com referências derivadas dos schemas de entrada (inclusive o `userId` do corpo); ids e chaves de outra organização respondem 404 com o código esperado, também para quem é membro das duas organizações, e o banco da outra fica intacto.
- [x] CA-10 A interface mostra lista, criação, visão geral, configurações e participantes, e esconde ações sem capacidade; jornada E2E real: criar projeto, adicionar participante, arquivar e restaurar.

## Casos limite

- Configuração "membros podem criar projetos" desligada enquanto um member cria: a criação é serializada com a alteração; um dos dois vê o estado do outro (sem criação depois do desligamento já confirmado).
- Participante rebaixado na organização entre a leitura das ações e a mudança no projeto: decisão pelo estado relido (403/409) e a interface recarrega.
- Owner/admin não participante: aparece como `manager` efetivo na leitura do projeto, mas não na lista de participantes (a interface explica que owner/admin gerenciam todos os projetos).
- Admin rebaixado a member na organização: perde o acesso aos projetos de que não participa (404 na próxima requisição).
- Chave digitada em minúsculas: a interface converte para maiúsculas; a API valida o formato e não normaliza silenciosamente.
- Remover da organização quem é o único participante `manager` de um projeto: permitido (owner/admin continuam gerenciando).
- Projeto arquivado: participante pode sair e ser removido; não pode ser adicionado nem ter o papel alterado.

## Restrições e dependências

- Depende das specs 001, 002 e 006 e dos ADRs 0003, 0004, 0006, 0012, 0013 e 0014.
- As seis obrigações da [spec 006](../006-permissions/design.md#transição-para-a-spec-003-obrigações-registradas) são parte do escopo.
- A FK composta de participações para `memberships` (obrigação 2 da 006, citada no ADR 0013) é a primeira referência de banco entre tabelas de contextos diferentes; a política fica no ADR 0015 (proposto com esta spec).

## Perguntas abertas

| #   | Pergunta                                                               | Responsável | Decisão                                                                                                                          |
| --- | ---------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | O workflow nasce nesta spec?                                           | Usuário     | Padrão fixo criado com o projeto, só leitura; configuração na spec 005                                                           |
| 2   | Projetos têm chave curta?                                              | Usuário     | Sim, única na organização e imutável (BR-025)                                                                                    |
| 3   | Ciclo de vida                                                          | Usuário     | Arquivar e restaurar; exclusão definitiva no backlog                                                                             |
| 4   | Gestão de participantes                                                | Usuário     | Manager adiciona membros da organização; membro sai sozinho; sem regra de último manager                                         |
| 5   | Atribuições abertas de quem sai do projeto (BR-003)                    | Spec 004    | Sem tarefas nesta spec; a 004 desfaz atribuições (FK `SET NULL`) e nunca bloqueia a remoção da organização (design, transição 3) |
| 6   | Limites de abuso (RNF-06)                                              | Design      | Valores do design aceitos na aprovação (D3)                                                                                      |
| 7   | Owner/admin viram participantes explícitos? (revisão de segurança, M3) | Usuário     | Não (D1-a, aprovação): já gerenciam todos os projetos; criador owner/admin não é gravado; adicioná-los é recusado                |
| 8   | Política para FKs entre contextos                                      | Usuário     | ADR 0015 aceito com a spec (D2)                                                                                                  |
