---
paths:
  - 'apps/**'
  - 'libs/**'
  - 'prisma/**'
---

# Regras de arquitetura

Referências: `docs/architecture/overview.md`, `docs/architecture/dependency-rules.md`, ADR 0003.

## Modular Monolith

- Um backend Express (`apps/api`), um worker futuro (`apps/worker`), um frontend Angular (`apps/web`). Nada de microsserviços.
- Cada bounded context vive em `libs/backend/<context>/` e é dividido em bibliotecas Nx por camada, criadas **somente quando houver código real**:
  - `domain` (`type:domain`): entidades, value objects, invariantes, domain events, contratos de repositório. TypeScript puro.
  - `application` (`type:application`): casos de uso, portas, orquestração transacional, autorização contextual.
  - `infrastructure` (`type:infrastructure`): repositórios Prisma, adapters Redis/BullMQ/e-mail.
  - `http` (`type:presentation`): routers, controllers, schemas Zod de entrada, mapeamento para contratos.
- Código compartilhado entre contextos: `libs/backend/shared/*` (`domain:shared`). Só entra ali o que **dois ou mais contextos já usam**.
- `libs/contracts` (`type:contracts`): contratos HTTP/eventos entre backend e frontend. Nunca entidades de domínio nem modelos Prisma.

## Regra de dependência

- `domain` não depende de nada além de outros `domain` do mesmo contexto ou `domain:shared`.
- `application` depende de `domain` e de portas que ela mesma define.
- `infrastructure` implementa portas/repositórios; `http` chama `application`.
- Contexto A **nunca** importa bibliotecas do contexto B. Quando A precisa de dados de B, A define uma porta na sua `application` e o composition root (`apps/api`) liga um adapter que chama a API pública de B.
- Tags e restrições estão em `eslint.config.mjs`; ao criar biblioteca, aplique tags `scope:*`, `domain:*` e `type:*`. Nunca contorne uma violação com `eslint-disable` — mude o design.

## Composição de dependências

- Constructor injection simples. Cada contexto expõe uma função `create<Context>Module(deps)` consumida pelo composition root.
- Sem container de DI, decorators de injeção ou service locators.

## Contra overengineering

- Padrão de projeto só com problema concreto que o justifique (ver seção "Padrões de projeto" em `docs/architecture/overview.md`). Registre a justificativa no design da spec.
- Sem repositório genérico `Repository<T>`; repositórios expressam operações do domínio (`findOpenByProject`, `saveWithVersion`).
- Sem CQRS completo: commands/queries são apenas casos de uso distintos.
- Sem bibliotecas vazias "para o roadmap". Sem abstração com uma única implementação **a menos que** seja uma porta de infraestrutura (repositório, relógio, fila) necessária para testar o domínio.
- Classes/serviços com mais de ~300 linhas ou mais de uma razão para mudar devem ser divididos.
