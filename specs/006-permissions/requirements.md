# 006 — Permissões · Requisitos

- **Status**: Aprovado
- **Fase do roadmap**: 1 — MVP (ordem 3, antes de `003-projects`)
- **Bounded contexts**: vocabulário compartilhado (`shared/kernel`); Organizations (`organizations`) adota o catálogo; Projects, Tasks e Boards consumirão nas specs 003–005
- **Autor / data**: Claude Code (com decisões do usuário) / 2026-10-13
- **Aprovado por / data**: usuário / 2026-10-13

## Objetivo

Dar ao TaskFlow uma única fonte de verdade para "quem pode fazer o quê": catálogo de permissões, papéis de organização e de projeto, papel efetivo e matrizes testadas, aplicadas no backend com negação por padrão, expostas ao frontend como capacidades e verificadas por testes de isolamento que não dependem de alguém lembrar de escrevê-los.

## Problema resolvido

Hoje a autorização está espalhada: a política de papéis da organização vive no domínio de `organizations`, o frontend mantém uma cópia manual dela (`role-policy.ts`) e a matriz de projeto existe só em documento. As specs 003–005 (projetos, tarefas, Kanban) dependem de papéis de projeto, de um papel efetivo que combine organização e projeto e de testes de isolamento por endpoint. Sem uma base comum, cada contexto reinventaria regras e testes, e o frontend divergiria do backend.

## Escopo

### Inclui

- Catálogo de permissões (organização e projeto) com negação por padrão: permissão fora do catálogo ou sem regra explícita é negada.
- Papéis de projeto (`manager`, `member`, `viewer`) e **papel efetivo** num projeto, com o papel da organização como teto (decisões 3 e 5).
- Matriz de permissões de organização (já aplicada pela spec 002) e de projeto (definida e testada sobre o modelo de papéis; ligada a projetos reais pela spec 003).
- Configuração da organização "membros podem criar projetos" (padrão: sim), editável por owner/admin.
- **Capacidades**: a API devolve as permissões efetivas do usuário na organização e as ações permitidas por recurso (ex.: por membro), calculadas pela mesma política do backend; o frontend deixa de espelhar regras.
- Harness reutilizável de testes de isolamento entre organizações e verificação automática de que **toda** rota tenant-scoped tem caso de isolamento.
- Registro da avaliação de RLS e da decisão de adiá-la (ADR).

### Não inclui

- Tabelas, endpoints e telas de projetos e membros de projeto (spec 003); tarefas, comentários, quadros e sprints (specs 004, 005, 007, Fase 2).
- Papéis customizáveis ou permissões por usuário (só papéis fixos).
- RLS no PostgreSQL (adiado para a Fase 4, decisão 2).
- Equipes, exclusão de organização, transferência dedicada de propriedade (continuam como na spec 002).
- Auditoria transacional (BR-007 segue com o desvio registrado na spec 002).

## Requisitos funcionais

| ID    | Requisito                                                                                                                                                                                                                                                                                                                                  | Prioridade |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| RF-01 | Existe um catálogo único de permissões de organização e de projeto; toda checagem de autorização do backend referencia uma permissão do catálogo (tabela caso de uso → permissão no design). Sair da organização não é permissão: é sempre permitido ao próprio membro, limitado por BR-019. Permissão desconhecida ou sem regra ⇒ negada. | Must       |
| RF-02 | O papel efetivo num projeto é calculado (BR-023): owner/admin da organização ⇒ `manager` em todos os projetos; member da organização ⇒ o papel do projeto; viewer da organização ⇒ no máximo `viewer`; sem participação ⇒ sem acesso (404).                                                                                                | Must       |
| RF-03 | A matriz de projeto (ler, configurar, arquivar, gerenciar membros, criar/editar/atribuir/excluir tarefas, comentar, moderar, sprints, quadro) é avaliável para qualquer papel efetivo, incluindo regras "só o próprio recurso".                                                                                                            | Must       |
| RF-04 | Owner e admin ativam ou desativam "membros podem criar projetos" (padrão: ativado) nas configurações da organização; a permissão `project:create` do member segue essa configuração (BR-024).                                                                                                                                              | Must       |
| RF-05 | `GET /organizations/{id}` devolve as capacidades do usuário na organização (lista de permissões efetivas), e "minhas organizações" também, para a interface escolher o que mostrar.                                                                                                                                                        | Must       |
| RF-06 | Cada membro listado traz as ações que o usuário atual pode executar sobre ele (papéis para os quais pode alterá-lo, se pode removê-lo), calculadas pela política de BR-021; o frontend usa isso no lugar da cópia local da política.                                                                                                       | Must       |
| RF-07 | A interface de organização (configurações, membros, convites, criação de projeto quando existir) mostra ou esconde ações só a partir das capacidades da API.                                                                                                                                                                               | Must       |
| RF-08 | Toda rota tenant-scoped montada no escopo do tenant tem caso de isolamento A/B executado na integração; uma rota nova sem caso faz o teste falhar.                                                                                                                                                                                         | Must       |

## Requisitos não funcionais

| ID     | Categoria      | Requisito mensurável                                                                                                                                                                                                                                                                                                                                 |
| ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RNF-01 | Segurança      | Negação por padrão comprovada por teste: cada par papel × permissão tem caso positivo/negativo com o esperado **transcrito literalmente** de `docs/security/authorization.md` (não derivado da matriz implementada); permissões inexistentes, `'constructor'`, `'__proto__'` e papel desconhecido são negados.                                       |
| RNF-02 | Segurança      | Capacidades são dica de interface: nenhuma mutação confia nelas; a decisão continua no caso de uso (sob lock quando a spec 002 já exige).                                                                                                                                                                                                            |
| RNF-03 | Consistência   | Backend e frontend usam a mesma origem das regras: o frontend não contém matriz de permissões própria (verificado por revisão e pela remoção de `role-policy.ts`).                                                                                                                                                                                   |
| RNF-04 | Desempenho     | As capacidades em `GET /organizations/{id}` e `GET /me/organizations` não adicionam consulta ao banco (papel já resolvido e organização já carregada).                                                                                                                                                                                               |
| RNF-05 | Isolamento     | Harness de isolamento na integração com a composição real de rotas: casos gerados para toda rota tenant-scoped, casos por referência (caminho, query, corpo) com ids reais de outra organização, snapshot genérico de todas as tabelas com `organizationId`; varredura do app falha com rota tenant fora do escopo ou rota global sem justificativa. |
| RNF-06 | Acessibilidade | A opção de configuração atende WCAG 2.2 AA (rótulo, estado anunciado, teclado).                                                                                                                                                                                                                                                                      |

## Regras de negócio

| BR                                                   | Aplicação nesta feature                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-002 / BR-003                                      | A matriz de projeto define quem altera e atribui tarefas; a aplicação a tarefas reais fica para a spec 004.                                                                                                                                                                                                                                                                             |
| BR-019 / BR-021 (spec 002)                           | Continuam como estão; passam a ser expressas pelo catálogo e alimentam as ações por membro (RF-06).                                                                                                                                                                                                                                                                                     |
| **BR-023 — Papel efetivo no projeto** (nova)         | Owner/admin da organização atuam como `manager` em todos os projetos. Member da organização tem o papel do projeto. Viewer da organização tem no máximo `viewer` em qualquer projeto (o papel da organização é teto; rebaixar na organização reduz o efetivo sem alterar dados do projeto). Sem participação no projeto ⇒ sem acesso, e o projeto responde 404 e não aparece em listas. |
| **BR-024 — Criação de projetos configurável** (nova) | Owner e admin sempre criam projetos. Members criam se a organização permitir ("membros podem criar projetos", padrão: sim). Viewers nunca criam. Alterar a configuração exige owner/admin e respeita BR-008 (versão da organização).                                                                                                                                                    |

## Critérios de aceitação (resumo)

- [x] CA-01 A matriz de organização e a de projeto respondem, para cada papel, exatamente o que está em `docs/security/authorization.md` (itens sem comportamento marcados como planejados e fora do catálogo); permissão inexistente é negada.
- [x] CA-02 Papel efetivo: owner/admin ⇒ manager; member ⇒ papel do projeto; viewer ⇒ no máximo viewer; sem participação ⇒ nenhum.
- [x] CA-03 Owner/admin desativam "membros podem criar projetos"; o member perde `project:create` nas capacidades; owner/admin mantêm.
- [x] CA-04 A resposta da organização traz as capacidades do usuário; um viewer não recebe `organization:update` nem `member:invite`.
- [x] CA-05 A lista de membros traz, por membro, as ações permitidas ao usuário atual (admin não recebe ações sobre owners).
- [x] CA-06 A interface esconde ações sem capacidade e não tem matriz própria; a API continua negando chamadas forjadas.
- [x] CA-07 Uma rota tenant-scoped sem caso de isolamento faz o teste de isolamento falhar; todas as rotas atuais passam.
- [x] CA-08 RLS: avaliação, gatilhos de reavaliação e decisão de adiamento registrados no ADR 0014, que substitui a parte de RLS do ADR 0004.
- [x] CA-09 Admin rebaixado durante a atualização da organização não grava nome nem configuração (decisão sob lock com releitura).

## Casos limite

- Papel alterado entre a leitura das capacidades e a ação: a API decide pelo estado atual (403/409) e a interface recarrega.
- Configuração alterada por outra pessoa enquanto a tela está aberta ⇒ 409 `VERSION_CONFLICT`, recarregar.
- Owner que se rebaixa: as capacidades mudam na próxima leitura (a interface já reflete o próprio papel após a alteração, spec 002/T23).
- Viewer da organização convidado depois como manager de um projeto (spec 003): a gravação acima do teto é recusada (obrigação registrada no design para a 003); rebaixar alguém a viewer na organização rebaixa suas participações.

## Restrições e dependências

- Depende das specs 001 e 002 e dos ADRs 0003, 0004 e 0012.
- O catálogo é vocabulário compartilhado (funções puras); nenhum contexto passa a ler tabelas de outro.
- A spec 003 consome RF-02/RF-03 e o harness (RF-08) ao criar projetos.

## Perguntas abertas

| #   | Pergunta                                                | Responsável | Decisão                                                                                  |
| --- | ------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| 1   | O que a 006 entrega antes de existirem projetos?        | Usuário     | Base (catálogo, política, harness) + matriz de projeto definida e testada; a 003 só liga |
| 2   | RLS agora?                                              | Usuário     | Adiar para a Fase 4, com avaliação registrada em ADR                                     |
| 3   | Criação de projeto por members                          | Usuário     | Configurável pela organização, padrão permitido (BR-024)                                 |
| 4   | Como a interface sabe o que mostrar                     | Usuário     | Capacidades calculadas pela API; frontend sem matriz própria                             |
| 5   | Viewer da organização pode ter papel maior num projeto? | Usuário     | Não: papel da organização é teto (BR-023)                                                |
| 6   | Quais projetos member/viewer enxergam                   | Usuário     | Só os que participam; owner/admin veem todos (BR-023)                                    |
| 7   | Papéis customizáveis                                    | Design      | Fora do escopo (papéis fixos)                                                            |
