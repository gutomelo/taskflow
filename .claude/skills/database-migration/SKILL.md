---
name: database-migration
description: Padroniza mudanças de schema no TaskFlow com Prisma 7 e PostgreSQL — modelagem multi-tenant, compatibilidade, geração e revisão da migration, rollback/roll-forward, integridade, índices, segurança de dados e validação com testes de integração. Use ao alterar prisma/schema.prisma.
argument-hint: "<descrição da mudança>"
---

# Migration de banco

Mudança: $ARGUMENTS

Siga `.claude/rules/database.md`. A mudança deve estar descrita no `design.md` de uma spec aprovada.

## 1. Modelagem

- Tabela tenant-scoped? → `organizationId` + FK + índices iniciando por ele + unicidade escopada.
- Edição concorrente? → `version Int @default(1)`.
- Constraints de integridade (NOT NULL, FK com `onDelete` consciente, UNIQUE, CHECK via SQL quando necessário).
- Índices derivados das consultas do `design.md` (não especulativos).
- Nomes: modelo PascalCase, `@@map("snake_case_plural")`, campos camelCase com `@map("snake_case")`.

## 2. Compatibilidade

- Classifique: **aditiva** (segura) ou **destrutiva/renomeação** (requer expand → migrate → contract).
- Coluna NOT NULL em tabela com dados exige default ou backfill em etapa separada.
- Índices em tabelas grandes: `CREATE INDEX CONCURRENTLY` em migration SQL editada manualmente (com `-- prisma-migrate: no-transaction` se aplicável).

## 3. Gerar e revisar

```bash
pnpm infra:up
pnpm db:migrate --name <descricao_snake_case>   # gera SQL + aplica no banco local + regenera client
```

Leia o SQL em `prisma/migrations/<timestamp>_<nome>/migration.sql` e confirme que faz exatamente o esperado (nada de DROP inesperado). Nunca edite migration já aplicada fora do ambiente local.

## 4. Rollback / roll-forward

Documente no `design.md`: como reverter (nova migration inversa) e impacto em dados. Prisma não gera "down"; o padrão do projeto é **roll-forward**.

## 5. Validar

- Testes de integração do repositório afetado (Testcontainers aplica as migrations do zero): `pnpm test:integration`.
- Isolamento entre organizações e conflito de versão cobertos quando aplicável.
- `pnpm nx affected -t lint typecheck test`.

Nunca rode `prisma migrate reset` ou comandos que apaguem dados sem autorização explícita do usuário.
