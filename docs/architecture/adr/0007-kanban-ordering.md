# 0007 — Ordenação Kanban com chaves fracionárias

- **Status**: Proposto — decisão final na spec 005
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

## Decisão (proposta)

Adotar **C**: coluna `rank` (`text`, collation `"C"` para comparação binária) com ordem total `(rank, id)`. O servidor calcula a chave entre `afterTaskId` e `beforeTaskId`; empates em movimentos concorrentes são resolvidos por `id`. Rebalanceamento de uma coluna em transação quando a chave ultrapassar um limite de tamanho. Algoritmo implementado como função pura no domínio de Boards, sem dependência externa (ou biblioteca pequena e auditada, a decidir na spec 005).

## Consequências

- **Positivas**: movimentos O(1) em escrita; determinismo sob concorrência.
- **Negativas**: lógica de geração de chaves precisa de testes extensivos (propriedades: ordem preservada, determinismo).
- **Como verificar**: testes de propriedade na função de ranking; teste de integração com movimentos concorrentes.
