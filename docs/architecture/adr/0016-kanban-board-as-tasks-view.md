# 0016 — Quadro Kanban como visão de Tasks; contexto Boards adiado

- **Status**: Aceito (2026-10-14, aprovação da spec 005)
- **Data**: 2026-10-14
- **Decisores**: usuário (product owner); arquitetura (Claude Code, revisão da spec 005)
- **Relacionados**: substitui a "Exceção conhecida" (Tasks × Boards) do [ADR 0003](0003-modular-monolith-clean-architecture.md); [ADR 0007](0007-kanban-ordering.md); [ADR 0014](0014-rls-deferred.md); [ADR 0015](0015-cross-context-referential-integrity.md); [spec 005](../../../specs/005-kanban/design.md); [bounded contexts](../bounded-contexts.md)

## Contexto

O mapa de contextos previa um contexto `boards` dono de quadros, colunas e da posição dos cards, e o ADR 0003 registrou como exceção conhecida que Tasks e Boards compartilhariam uma fronteira transacional na movimentação. Na spec 005 o usuário decidiu: um quadro por projeto, coluna = status do workflow, cards = tarefas de primeiro nível não canceladas, sem WIP, sem raias, sem tempo real. Com isso, o único estado próprio do quadro seria a posição do card.

Mantida em `boards`, essa posição obrigaria a: (1) ler colunas ordenando tarefas por um dado de outro contexto — junção entre tabelas de contextos (proibida) ou cópia do status e do "é card" em `boards`; (2) manter essa cópia síncrona em toda escrita de `tasks` que muda status, cancela, reabre ou cria (porta `tasks → boards`), além de `boards → tasks` no movimento — dependência nos dois sentidos e duas fontes da verdade para "em que coluna está"; (3) compartilhar a transação entre os dois contextos.

## Alternativas consideradas

### A — Contexto `boards` com tabela de cards (status espelhado)

- Prós: segue o mapa original; prepara vários quadros por projeto.
- Contras: estado duplicado com sincronização obrigatória em todos os caminhos de escrita de `tasks`; portas nos dois sentidos; exceção transacional permanente; custo sem requisito presente.

### B — Contexto `boards` sem tabelas (só casos de uso sobre portas de `tasks`)

- Prós: nome de contexto preservado.
- Contras: contexto sem estado nem regra própria; cerimônia sem benefício (`.claude/rules/architecture.md`, "Contra overengineering").

### C — Quadro como visão de `tasks` (`tasks.board_rank`) e `boards` adiado

- Prós: uma fonte da verdade; um movimento escreve uma linha; status e posição na mesma transação de um único contexto (BR-010 sem exceção); nenhuma porta nova; as chaves servem a visões filtradas futuras (sprint, responsável).
- Contras: `tasks` passa a conhecer a ordem do quadro; quando houver estado de quadro real, a extração exige migrar a coluna.

## Decisão

Adotar **C**.

1. A posição do card é a coluna `tasks.board_rank` (chave fracionária, [ADR 0007](0007-kanban-ordering.md)); leitura do quadro, `MoveCard` e o ranking vivem em `libs/backend/tasks/*`.
2. O workflow (status e transições) continua em `projects`; `projects` usa a porta `WorkflowStatusUsage` (na sua `application`, ligada no composition root à fundação de `tasks`) para contar e reatribuir tarefas de um status.
3. O contexto `boards` fica **adiado**. Gatilhos para criá-lo: estado próprio de quadro (vários quadros por projeto, limites de WIP, raias, colunas que não são 1:1 com status, filtros salvos).
4. Substitui a "Exceção conhecida" do ADR 0003: não há fronteira transacional compartilhada entre contextos no movimento de cards.

## Consequências

- **Positivas**: BR-004, BR-009 e BR-010 num único contexto e numa transação; sem junção entre contextos; menos portas e menos passos de montagem.
- **Negativas / custos**: `tasks` acumula a responsabilidade de ordenar o quadro; a extração futura de `boards` exige mover a coluna e os casos de uso; o rebalanceamento de coluna usa um `UPDATE` raw tenant-scoped (avaliado contra o gatilho do ADR 0014 no ADR 0007).
- **Riscos e mitigação**:

  | Risco                                              | Mitigação                                                                          |
  | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
  | Requisitos de quadro crescerem dentro de `tasks`   | Gatilhos do item 3; revisão de arquitetura por spec                                |
  | Collation `"C"` perdida numa migration             | Teste de catálogo e teste de ordenação com maiúsculas e minúsculas                 |
  | Documentos antigos citando `boards` como existente | `bounded-contexts.md`, `data-flow.md`, BR-004 e BR-009 atualizados no mesmo commit |

- **Como verificar**: `pnpm lint` (nenhuma biblioteca `domain:boards`; `projects` sem acesso a modelos de `tasks`); testes de integração de movimento e de edição do workflow sob concorrência; teste de composição de `apps/api` com a porta `WorkflowStatusUsage` ligada à fundação de `tasks`.

## Referências

- Spec 005 (requisitos: decisões 1–8; design: D1)
- ADR 0003, 0007, 0014, 0015; `docs/architecture/bounded-contexts.md`
