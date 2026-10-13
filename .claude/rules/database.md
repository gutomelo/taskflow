---
paths:
  - 'prisma/**'
  - 'prisma.config.ts'
  - 'libs/backend/**/infrastructure/**'
---

# Regras de banco de dados (PostgreSQL + Prisma 7)

Referências: ADR 0004 (multi-tenancy), ADR 0006 (concorrência), skill `/database-migration`.

## Schema

- Schema multi-arquivo: `prisma/schema.prisma` contém só `generator` e `datasource`; modelos em `prisma/models/<contexto>.prisma` (um arquivo por bounded context; `shared.prisma` para infraestrutura compartilhada). `prisma.config.ts` aponta para o **diretório** `prisma`. Migrations em `prisma/migrations/`.
- Relações Prisma entre arquivos de contextos diferentes são proibidas (contextos não referenciam tabelas uns dos outros), exceto sob os critérios do ADR 0015 e listadas em `docs/architecture/bounded-contexts.md` (FK para a organização e para a membership); as demais referências entre contextos são IDs sem FK ou passam por portas. Client gerado em `libs/backend/shared/infrastructure/src/generated/prisma` (não versionado).
- Modelos em PascalCase inglês, tabelas/colunas em snake_case via `@@map`/`@map`.
- IDs: UUID v7 gerado na aplicação (ordenável, sem enumeração). Timestamps `created_at`/`updated_at` em `timestamptz`.
- Toda tabela tenant-scoped tem `organization_id NOT NULL` com FK, e **todo índice de consulta começa por `organization_id`**.
- Entidades editáveis concorrentemente (task, board column, sprint, project) têm `version Int @default(1)`.
- Unicidade sempre escopada ao tenant: `@@unique([organizationId, key])`, nunca unicidade global acidental.
- Soft delete apenas quando a spec exigir (ex.: arquivamento de projeto); prefira `archived_at` explícito.

## Acesso a dados

- Prisma só existe em `infrastructure`. Repositórios recebem `organizationId` do `RequestContext` e o aplicam em **toda** consulta — inclusive `update`/`delete` (`where: { id, organizationId }`).
- Proibido `findUnique({ where: { id } })` em tabela tenant-scoped sem filtro de organização.
- `$queryRaw` apenas com template tag parametrizada; nunca `$queryRawUnsafe` com entrada externa.
- Evite N+1: use `include`/`select` explícitos ou consultas agregadas; nunca consultas dentro de loops.
- `select` explícito em leituras de listagem; paginação obrigatória (cursor para listas grandes).

## Transações e concorrência

- Operações que alteram estado principal + registros dependentes (auditoria, outbox) usam `prisma.$transaction(async (tx) => ...)` (BR-010). O caso de uso controla a fronteira via porta `TransactionRunner`; repositórios aceitam o `tx`.
- Optimistic locking: `updateMany({ where: { id, organizationId, version }, data: { ..., version: { increment: 1 } } })`; `count === 0` → `ConcurrencyConflictError` (HTTP 409).
- Nada de efeitos externos (fila, socket, e-mail) dentro da transação.

## Migrations

- Geradas por `pnpm db:migrate --name <descricao_em_ingles>`; revisar o SQL gerado antes de commitar.
- Nunca editar migration já aplicada em ambiente compartilhado; corrigir com nova migration (roll-forward).
- Mudanças destrutivas seguem expand → migrate → contract em releases separados.
- Índices grandes em produção: `CREATE INDEX CONCURRENTLY` em migration SQL manual.
- RLS do PostgreSQL é defesa adicional planejada (ADR 0004) — não substitui o filtro na aplicação.
