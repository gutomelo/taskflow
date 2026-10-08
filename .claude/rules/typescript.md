---
paths:
  - "**/*.ts"
  - "**/*.mts"
---

# Regras de TypeScript

- `strict`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature` e `noImplicitOverride` estão ativos em `tsconfig.base.json`. Não desative por projeto.
- Proibido `any` explícito. Use `unknown` + narrowing (Zod nas fronteiras, type guards internamente).
- Proibido `as` para "convencer" o compilador (`as unknown as X`, `!` non-null sem garantia). Casts só com comentário justificando a invariante que os torna seguros.
- Prefira `type` para uniões/composições e `interface` para contratos implementáveis (portas, repositórios).
- Enums: prefira uniões de string literal (`'todo' | 'in_progress'`) ou `as const` objects. Use `enum` apenas se o Prisma gerar.
- Nomes completos e em inglês: `organizationId`, não `orgId`; `repository`, não `repo`. Booleanos com prefixo `is/has/can/should`.
- Funções puras e imutabilidade por padrão (`readonly`, `ReadonlyArray`). Mutação apenas dentro de entidades, via métodos que preservam invariantes.
- Erros: lance subclasses tipadas (ex.: `DomainError` com `code` estável). Nunca `throw 'string'`, nunca `catch {}` vazio; se capturar, trate, enriqueça ou relance.
- Datas: armazene e transporte em UTC (ISO 8601). Obtenha "agora" por uma porta `Clock` em domínio/aplicação para testes determinísticos.
- Imports: use path aliases `@taskflow/...` entre projetos; imports relativos apenas dentro do mesmo projeto. Nunca importe de `src/lib/...` de outro projeto — apenas do `index.ts` público.
- Arquivos em kebab-case com sufixo de papel: `create-task.use-case.ts`, `task.entity.ts`, `prisma-task.repository.ts`, `task.router.ts`.
- Comentários em português, explicando **por quê**, não o quê. Sem código comentado.
