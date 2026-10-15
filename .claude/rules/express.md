---
paths:
  - 'apps/api/**'
  - 'apps/worker/**'
  - 'libs/backend/**'
---

# Regras de backend (Express + Clean Architecture)

Referências: `docs/architecture/data-flow.md`, `.claude/rules/api-design.md`.

## Fluxo obrigatório

`Router → middlewares (requestId, auth, tenant, rate limit) → controller → use case → domain → porta de repositório → adapter Prisma`.

- **Controller**: extrai e valida entrada (Zod), monta o comando, chama **um** caso de uso, mapeia o resultado para o contrato de resposta. Sem regra de negócio, sem Prisma, sem `if` de permissão de domínio.
- **Use case**: uma classe/função por intenção (`CompleteTaskUseCase`). Recebe dependências pelo construtor, recebe um `RequestContext` (`userId`, `organizationId`, `requestId`) explícito — nunca lê `req` nem variáveis globais.
- **Domain**: invariantes dentro das entidades/value objects. Erros de regra viram `DomainError` com `code` estável (ex.: `TASK_HAS_PENDING_SUBTASKS`).
- **Repositório**: interface no domínio/aplicação, implementação `Prisma*Repository` na infraestrutura; retorna entidades de domínio, nunca tipos Prisma.

## Erros

- Middleware central de erro converte erros conhecidos em `application/problem+json` (contrato `ProblemDetails` de `@taskflow/contracts`).
- Mapeamento: validação → 400/422, não autenticado → 401, sem permissão → 403, recurso de outro tenant ou inexistente → **404** (não revela existência), conflito de versão → 409, regra de negócio → 422, rate limit → 429.
- Erros inesperados → 500 com mensagem genérica + `requestId`; detalhes apenas no log.
- Express 5 propaga rejeições de handlers `async` — não envolva com `try/catch` só para chamar `next(err)`.

## Middlewares e composição

- `createApp(deps)` monta o app sem efeitos colaterais (sem `listen`, sem conexão), permitindo testes com Supertest.
- `main.ts` é o composition root: carrega config validada, cria clientes (Prisma, Redis), módulos, servidor e trata graceful shutdown (`SIGTERM`/`SIGINT`).
- Configuração **somente** via `loadConfig()` (Zod). Proibido `process.env` fora do módulo de config.
- Helmet, limite de payload (`express.json({ limit })`), `x-powered-by` desligado, `trust proxy` configurado explicitamente.

## Logging

- Pino estruturado; `req.log` dentro de requests. Campos: `requestId`, `userId`, `organizationId` quando autenticado.
- Redação obrigatória de `authorization`, `cookie`, `set-cookie`, `password`, `token`, `refreshToken`.
- Não use `console.*` no código de produção.

## Assíncrono e tempo real (fases futuras)

- Efeitos colaterais (e-mail, notificação, socket) são disparados **após o commit** — via domain events despachados pós-transação ou outbox (ADR 0008).
- Eventos Socket.IO vindos do cliente nunca alteram estado diretamente; mutações passam por casos de uso HTTP com autorização.
- Jobs BullMQ são idempotentes (chave de idempotência), com retry/backoff e tratamento de falha permanente.
