---
name: create-domain-module
description: Padroniza a criação ou extensão de um bounded context no backend do TaskFlow — limites do domínio, bibliotecas Nx por camada com tags, entidades, value objects, invariantes, contratos de repositório, casos de uso, composição e testes. Use quando uma spec aprovada introduz um contexto novo ou novas entidades num contexto.
argument-hint: "<contexto> (ex.: tasks, projects)"
---

# Criar módulo de domínio

Contexto: `$0`

Referências: `docs/architecture/bounded-contexts.md`, `docs/architecture/dependency-rules.md`, `.claude/rules/architecture.md`.

## 1. Limites

- Responsabilidades do contexto (copie de `bounded-contexts.md`) e o que **não** é dele.
- Linguagem ubíqua: termos e seus nomes em inglês no código.
- Dependências de outros contextos → portas na `application` deste contexto, implementadas no composition root.

## 2. Bibliotecas Nx (crie só as camadas com código nesta entrega)

```bash
pnpm nx g @nx/js:library libs/backend/$0/domain --name=backend-$0-domain \
  --importPath=@taskflow/backend/$0/domain --bundler=none --unitTestRunner=vitest \
  --linter=eslint --useProjectJson=true --minimal=true \
  --tags="scope:backend,domain:$0,type:domain" --no-interactive
```

Repita para `application` (`type:application`), `infrastructure` (`type:infrastructure`) e `http` (`type:presentation`). Se `domain:$0` ainda não existe em `eslint.config.mjs`, adicione a restrição `domain:$0 → [domain:$0, domain:shared]`.

## 3. Domain

- Entidades com identidade, criadas por factory estática que valida invariantes (`Task.create(...)`), reidratadas por `Task.restore(...)` sem revalidar regras de criação.
- Value objects imutáveis com validação no construtor (`TaskTitle`, `Priority`).
- Métodos de comportamento expressam regras (`task.complete(clock)`), lançando `DomainError` com `code` estável.
- Domain events apenas quando houver consumidor real planejado.
- Interfaces de repositório expressivas (`TaskRepository.findById(organizationId, id)`), sem tipos Prisma.

## 4. Application

- Um caso de uso por intenção, com dependências no construtor e `RequestContext` explícito.
- Autorização contextual (política do contexto) antes de alterar estado.
- Fronteira transacional via porta `TransactionRunner` quando houver múltiplas escritas.

## 5. Composição

`create<Context>Module({ prisma, clock, ... })` em `infrastructure` ou no composition root, devolvendo routers/casos de uso prontos para `apps/api`.

## 6. Testes

Domínio (invariantes e BRs com ID no nome), aplicação (fakes em memória), integração do repositório (Testcontainers, incluindo isolamento por organização). Verifique `pnpm nx affected -t lint typecheck test` — o lint confirma os limites.
