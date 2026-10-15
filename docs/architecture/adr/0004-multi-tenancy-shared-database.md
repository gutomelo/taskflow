# 0004 — Multi-tenancy com banco compartilhado e isolamento por `organizationId`

- **Status**: Aceito (estratégia base) · RLS: **adiado para a Fase 4** — ver [0014](0014-rls-deferred.md)
- **Data**: 2026-10-08
- **Relacionados**: [multi-tenancy](../../security/multi-tenancy.md), specs 002 e 006

## Contexto

Cada organização é um tenant lógico. Vazamento de dados entre organizações é o risco mais grave do produto. O MVP precisa ser simples de operar (um PostgreSQL) e testável localmente.

## Alternativas consideradas

### A — Banco por tenant

- Prós: isolamento físico.
- Contras: migrations N vezes, pool de conexões por tenant, custo e complexidade operacional altos.

### B — Schema por tenant

- Prós: isolamento razoável.
- Contras: Prisma não troca de schema por request de forma natural; migrations multiplicadas.

### C — Tabelas compartilhadas com coluna `organization_id` e filtro na aplicação

- Prós: simples, escala bem para o porte esperado, uma migration.
- Contras: depende de disciplina; um filtro esquecido vaza dados.

### D — C + Row Level Security (RLS) do PostgreSQL

- Prós: defesa em profundidade no banco.
- Contras: com Prisma exige definir `set_config('app.organization_id', ...)` **dentro de cada transação** (ou extensão do client), cuidado com pool de conexões, papel de banco sem `BYPASSRLS` para a aplicação e outro para migrations; testes e depuração mais complexos.

## Decisão

Adotamos **C** como base obrigatória, com controles que reduzem o risco de filtro esquecido:

1. O tenant é resolvido no servidor (sessão + membership) e entregue aos casos de uso em `RequestContext`; nunca vem do cliente como prova.
2. Repositórios recebem `organizationId` em toda assinatura de método tenant-scoped; não existe método sem ele.
3. Índices e unicidades começam por `organization_id`.
4. Testes de isolamento obrigatórios por feature (`.claude/rules/testing.md`).
5. Revisão automatizada (`/security-audit`) busca queries sem `organizationId`.

**RLS (D)** fica **proposto** como defesa adicional: a spec 006 fará um spike com Prisma 7 + `@prisma/adapter-pg` (transação com `set_config` local) medindo impacto em latência e complexidade, e decidirá por novo ADR.

## Consequências

- **Positivas**: operação simples; isolamento verificado por testes desde a primeira feature.
- **Negativas**: risco residual de erro humano até a eventual adoção de RLS.
- **Como verificar**: testes de isolamento A/B por endpoint; auditoria de segurança por spec.
