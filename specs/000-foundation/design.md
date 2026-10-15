# 000 — Fundação do projeto · Design técnico

- **Status**: Aprovado
- **Requisitos**: [requirements.md](requirements.md)

## Solução proposta

Monorepo Nx (path aliases) com dois apps e duas bibliotecas. A API segue o padrão de composition root + `createApp(deps)` puro; dependências externas (Prisma, Redis) são criadas em `main.ts` e expostas ao app por **probes** (`DependencyProbe`) — o app não conhece Prisma nem Redis. A web usa Signals + `httpResource` contra contratos compartilhados.

## Componentes

| Projeto                              | Tags                                                    | Conteúdo                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api`                           | `scope:backend`, `type:app`                             | `config/env.ts` (Zod), `app.ts` (`createApp`), `main.ts` (composition root, shutdown), `http/` (request id, logger, problem details, error handler), `health/` (router + `checkReadiness`). |
| `libs/backend/shared/infrastructure` | `scope:backend`, `domain:shared`, `type:infrastructure` | `createPrismaClient`, `createRedisClient`, `DependencyProbe` e probes de PostgreSQL/Redis, Prisma Client gerado.                                                                            |
| `libs/contracts`                     | `scope:shared`, `domain:shared`, `type:contracts`       | Schemas Zod: `LivenessReport`, `ReadinessReport`, `ProblemDetails`.                                                                                                                         |
| `apps/web`                           | `scope:frontend`, `type:app`                            | Tokens/tema, `core/layout/app-shell`, `features/system-status`.                                                                                                                             |
| `apps/web-e2e`                       | `scope:frontend`, `type:e2e`                            | Teste de fumaça da página de status.                                                                                                                                                        |

## Fluxo — readiness

`GET /health/ready` → `checkReadiness(probes, timeoutMs)` executa `probe.check()` de cada dependência em paralelo com `Promise.race` contra timeout, mede latência e devolve `ReadinessReport`. Status HTTP 200 se todas `up`, senão 503. Falhas são logadas (com o erro) mas a resposta contém apenas nome/estado/latência.

## Configuração (`loadConfig`)

| Variável                  | Tipo                                | Padrão             |
| ------------------------- | ----------------------------------- | ------------------ |
| `NODE_ENV`                | `development \| test \| production` | `development`      |
| `API_HOST` / `API_PORT`   | string / int                        | `0.0.0.0` / `3333` |
| `LOG_LEVEL`               | nível Pino                          | `info`             |
| `DATABASE_URL`            | URL `postgresql://`                 | obrigatório        |
| `REDIS_URL`               | URL `redis://`                      | obrigatório        |
| `HEALTH_CHECK_TIMEOUT_MS` | int 100–10000                       | `2000`             |
| `TRUST_PROXY`             | `false` ou nº de hops               | `false`            |
| `JSON_BODY_LIMIT`         | string                              | `100kb`            |

Erros de validação listam o **nome** da variável e a mensagem do schema; nunca o valor recebido.

## Erros

`HttpError(status, code, title, detail?)` para erros de transporte; o error handler converte `HttpError`, erro de payload do `express.json` (413/400) e qualquer outro erro (500 genérico) em `ProblemDetails` com `requestId`. Rota não encontrada → 404 `ROUTE_NOT_FOUND`.

## Request ID e logs

`pino-http` com `genReqId`: aceita `x-request-id` que case `^[A-Za-z0-9._-]{1,128}$`, senão gera `randomUUID()`; ecoa no header de resposta. Redação: `req.headers.authorization`, `req.headers.cookie`, `res.headers["set-cookie"]`, `*.password`, `*.token`, `*.refreshToken`. Em desenvolvimento, `pino-pretty` como stream síncrono carregado por `import()` dinâmico (sem `transport`/worker thread, que encerrava o processo sob o executor `@nx/js:node`; em produção nunca é carregado).

## Frontend

- Estilos: `styles/tokens.css` → `styles/tailwind.css` (Tailwind 4 + `@theme inline`) → `styles/material-theme.scss` (`mat.theme` + overrides para tokens). PostCSS em `apps/web/.postcssrc.json`.
- `provideHttpClient(withFetch())`, rotas lazy; proxy de dev (`proxy.conf.json`) para `/api` e `/health`.
- `SystemStatusPage`: `httpResource<ReadinessReport>` em `/health/ready`; resposta 503 carrega o relatório no corpo do erro e é exibida como "degradado"; falha de rede exibe "API indisponível" com botão "Tentar novamente" (`reload()`).

## Testes

| Nível              | O quê                                                                                                     |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| Unit (contracts)   | Schemas aceitam/rejeitam formatos.                                                                        |
| Unit (api)         | `loadConfig` (válido, inválido sem vazar valores), `checkReadiness` (up, down, timeout).                  |
| HTTP (api)         | Supertest com probes falsas: live 200; ready 200/503; 404 Problem Details; request id ecoado/gerado; 413. |
| Integração (infra) | Testcontainers: probe PostgreSQL e Redis `up` com containers reais; `down` com endereço inválido.         |
| Unit (web)         | Página de status: carregando, pronto, degradado (503), indisponível.                                      |
| E2E                | Página de status carrega e mostra título e o resultado da verificação.                                    |

## Infraestrutura

- `docker-compose.yml`: `postgres:18-alpine` e `redis:8-alpine` com healthcheck, volumes nomeados, portas em `127.0.0.1`. Perfil `app`: `migrate`, `api` e `web` (Nginx) construídos de `infra/docker/`.
- CI (`.github/workflows/ci.yml`): checkout → pnpm/Node 24 com cache → `install --frozen-lockfile` → `prisma generate` → `format:check` → `nx affected -t lint typecheck test build` → job separado de integração (Docker disponível no runner). Permissões `contents: read`.
- `dependabot.yml`: npm e GitHub Actions semanais, agrupando Angular e Nx.

## Decisões

| Decisão                              | Alternativas                        | Escolha                                                                                | ADR                 |
| ------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------- | ------------------- |
| Health desacoplado de infraestrutura | App chamar Prisma/Redis diretamente | Probes injetadas                                                                       | — (padrão de porta) |
| OpenAPI na fundação                  | Documentar só health                | Adiado para o primeiro endpoint de negócio (spec 001), gerado a partir dos schemas Zod | 0002                |
| `apps/worker` na fundação            | App vazio                           | Adiado                                                                                 | 0002                |
| Husky                                | Hooks Git                           | Não adotado                                                                            | 0002                |

## Riscos

| Risco                                         | Mitigação                                                        |
| --------------------------------------------- | ---------------------------------------------------------------- |
| Incompatibilidades de versões muito recentes  | Versões verificadas (ADR 0002); Dependabot; `minimumReleaseAge`. |
| Testcontainers indisponível em algum ambiente | Testes de integração em target separado; CI com Docker.          |
