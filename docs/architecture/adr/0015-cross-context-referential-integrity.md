# 0015 — Integridade referencial entre bounded contexts no banco

- **Status**: Proposto (decisão com a aprovação da spec 003)
- **Data**: 2026-10-13
- **Decisores**: usuário (product owner); arquitetura (Claude Code, revisão da spec 003)
- **Relacionados**: [ADR 0003](0003-modular-monolith-clean-architecture.md), [ADR 0013](0013-authorization-shared-kernel.md), [ADR 0014](0014-rls-deferred.md), [spec 003](../../../specs/003-projects/design.md), [spec 006](../../../specs/006-permissions/design.md), [bounded contexts](../bounded-contexts.md)

## Contexto

O ADR 0003 estabelece que contextos não se importam e só se integram por portas ligadas no composition root. `bounded-contexts.md` diz que cada contexto é dono das suas tabelas, e o cabeçalho de `prisma/schema.prisma` proíbe relações entre contextos.

O ADR 0013 (item 4) e a obrigação 2 da spec 006 exigem, porém, que as participações de projeto (`project_members`, contexto `projects`) desapareçam na mesma transação em que a membership (`memberships`, contexto `organizations`) é apagada, por qualquer caminho. Só uma FK composta `ON DELETE CASCADE` garante isso sem depender de código.

Com Prisma, uma FK só existe de forma estável se a relação for declarada nos dois modelos: a FK declarada só em SQL é removida como drift no próximo `migrate dev`. Por isso `Membership` precisa de um campo de back-relation.

A spec 004 terá a mesma pressão: responsável de tarefa × participação (BR-003) e status da tarefa × workflow do projeto. Sem política, cada caso vira exceção ad hoc.

## Alternativas consideradas

### A — Nenhuma FK entre contextos; propagação só por portas

- Prós: fronteira de dados pura.
- Contras:
  - a invariante depende de todo caminho de remoção lembrar da porta, inclusive os futuros (exclusão de organização ou de conta, retenção);
  - um caminho esquecido deixa privilégio adormecido;
  - contraria o ADR 0013.

### B — FK entre contextos com `ON DELETE RESTRICT` + porta explícita de limpeza

- Prós: integridade garantida no banco, e o código do contexto dependente executa (eventos, efeitos de negócio).
- Contras: o caminho que esquecer a porta falha com erro 500 em produção; é mais uma porta por relação; também exige back-relation.

### C — FK entre contextos com `ON DELETE CASCADE` ou `SET NULL`, permitida só sob critérios, com back-relation inerte

- Prós: atômica, independente de caminho, sem código extra; cumpre o ADR 0013.
- Contras:
  - o banco apaga ou desliga linhas do contexto dependente sem executar o código dele;
  - o schema do contexto fornecedor cita um modelo do dependente;
  - abre precedente.

## Decisão

Adotamos **C**, restrita por critérios.

1. Uma FK entre tabelas de contextos diferentes só é permitida quando **todos** os critérios valem:
   - (a) protege uma invariante de segurança ou de existência ("não existe X sem Y") que não pode depender de caminho de código;
   - (b) aponta do contexto **dependente** para o **fornecedor**, na mesma direção das setas de consulta em `bounded-contexts.md`;
   - (c) é composta com `organization_id` (ADR 0014);
   - (d) a ação é `CASCADE`, `RESTRICT` ou `SET NULL (coluna)`, sem alterar dados de negócio além de apagar ou desligar a referência; `RESTRICT` nunca pode bloquear a revogação de acesso (remover da organização, sair);
   - (e) está listada na tabela de exceções de `bounded-contexts.md` com a spec que a introduziu.
2. Primeira exceção: `project_members (organization_id, user_id) → memberships (organization_id, user_id) ON DELETE CASCADE ON UPDATE RESTRICT` (spec 003; obrigação 2 da spec 006).
3. A back-relation exigida pelo Prisma no modelo fornecedor é **inerte**:
   - o código do contexto fornecedor não a usa, o que é barrado por `no-restricted-syntax` em `eslint.config.mjs`;
   - um comentário no modelo aponta para este ADR.
4. Remoções em cascata não emitem evento do contexto dependente; o evento do contexto fornecedor (ex.: `organizations.member_removed`) é a evidência. Se uma regra de negócio do dependente precisar executar código na remoção, usa-se a alternativa B para aquela relação, por decisão registrada na spec.
5. Toda nova FK entre contextos é decidida no design da spec que a introduz e verificada contra os critérios do item 1. Fora deles, exige ADR.

## Consequências

- **Positivas**:
  - invariantes de acesso garantidas no banco;
  - regra explícita contra o uso indiscriminado;
  - coerente com a preparação para RLS.
- **Negativas / custos**:
  - o schema do fornecedor cita modelos do dependente;
  - remoções em cascata ficam sem evento próprio;
  - a spec 004 escolhe entre `SET NULL` (critério 1) e a alternativa B para BR-003, nunca `RESTRICT` sobre a remoção da organização.
- **Riscos e mitigação**:

  | Risco                                | Mitigação                                                                    |
  | ------------------------------------ | ---------------------------------------------------------------------------- |
  | Precedente indiscriminado            | Critérios, tabela de exceções e revisão de arquitetura por spec              |
  | Uso da back-relation pelo fornecedor | Lint                                                                         |
  | Migration que remova a FK            | Relação declarada nos dois modelos e teste de integração que prova a cascata |

- **Como verificar**:
  - teste de integração "remover e reconvidar" (BR-027);
  - `pnpm lint` com a regra da back-relation;
  - revisão de `bounded-contexts.md` a cada spec.

## Referências

- ADR 0013 (item 4), spec 006 (obrigação 2), spec 003 (design, "Modelagem de dados")
- PostgreSQL: foreign keys, `ON DELETE SET NULL (column_list)` (15+)
- Prisma: relações com chaves compostas e referential actions
