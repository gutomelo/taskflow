# 0007 — Ordenação Kanban com chaves fracionárias

- **Status**: Aceito (2026-10-14, spec 005)
- **Data**: 2026-10-08
- **Relacionados**: BR-009

## Contexto

Cards precisam de ordem determinística dentro da coluna, com movimentos frequentes e concorrentes, sem reescrever a posição de todos os cards a cada movimento.

## Alternativas consideradas

### A — Posição inteira sequencial (0, 1, 2…)

- Contras: um movimento reescreve N linhas; alto potencial de conflito.

### B — Posição decimal (média entre vizinhos)

- Contras: perda de precisão após muitas inserções no mesmo ponto; exige rebalanceamento.

### C — Chave fracionária em string (fractional indexing / estilo LexoRank)

- Prós: um movimento altera uma linha; chaves comparáveis lexicograficamente; espaço praticamente ilimitado entre vizinhos.
- Contras: chaves crescem em casos extremos; rebalanceamento ocasional.

## Decisão

Adotamos **C**, implementado à mão em `libs/backend/tasks/domain/src/lib/board/rank.ts` (decisão 8 da spec 005: sem dependência nova). O quadro é uma visão de `tasks` ([ADR 0016](0016-kanban-board-as-tasks-view.md)), então a chave é a coluna `tasks.board_rank`.

1. **Formato** (esquema conhecido de _fractional indexing_): alfabeto base 62 `0-9A-Za-z` em ordem ASCII; a chave é uma **cabeça** que codifica o tamanho da parte inteira (`a`…`z` positivos, `Z`…`A` negativos), a parte inteira e uma fração opcional que nunca termina em `0`. Acrescentar no fim ou no topo incrementa ou decrementa a parte inteira — crescimento O(log₆₂ n); só inserções repetidas no mesmo ponto do meio alongam a fração.
2. **Comparação**: `<`/`>` de string no código e collation `"C"` na coluna (nunca `localeCompare`; testes de catálogo da collation e de ordenação com maiúsculas e minúsculas). Ordem total `(board_rank, id)`.
3. **Empates** (acréscimos no fim sem lock podem gerar a mesma chave): desempate por `id`; `keyBetween` exige `a < b`, e o movimento que encontra o par empatado rebalanceia antes de calcular.
4. **Rebalanceamento**: quando a chave nova passa de 32 caracteres ou o par está empatado, só dentro do movimento (que segura o lock do projeto em `tasks`); as linhas da coluna são travadas em ordem de `id` e reescritas com `spreadKeys(n)` num único `UPDATE … FROM unnest($ids, $ranks)` parametrizado, filtrado por organização, projeto e status. Limitado a 30 por projeto por hora. CHECK do banco: tamanho ≤ 64 e alfabeto.
5. **Backfill** das tarefas existentes: `'e' || lpad(number, 5, '0')` (chaves válidas, crescentes pelo número).

**Gatilho do ADR 0014 avaliado** ("primeiro SQL raw tenant-scoped"): o rebalanceamento é a primeira **escrita** raw tenant-scoped (já havia SELECTs raw de lock). Decisão: o RLS continua adiado — o comando é único, parametrizado, filtra `organization_id`, `project_id` e `status_id` no próprio `WHERE`, só reordena linhas já travadas pelo caso de uso e é coberto pelo snapshot de tabelas do harness de isolamento; nenhum dado de outro tenant é lido ou devolvido.

## Consequências

- **Positivas**: movimentos O(1) em escrita; determinismo sob concorrência.
- **Negativas**: lógica de geração de chaves precisa de testes extensivos (propriedades: ordem preservada, determinismo).
- **Como verificar**: testes de propriedade em `rank.spec.ts` (ordem, determinismo, 10 000 acréscimos e inserções no topo ≤ 32 caracteres, meio sinaliza rebalanceamento); integração com movimentos concorrentes, empate forçado e rebalanceamento (spec 005).
