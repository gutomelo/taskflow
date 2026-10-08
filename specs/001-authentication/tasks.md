# 001 — Identity & Access · Tarefas

Regras: uma tarefa por execução de `/implement-spec`; marcar `[x]` somente com evidência executada (seção abaixo). Toda tarefa termina com `pnpm nx affected -t lint typecheck test` passando.

## Bloco A — Fundações compartilhadas

| ID  | Tarefa                                                                                                                                                                                                                                                                                                                 | Depende de | Verificação                                                                                                                             | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T1  | Infra local: Mailpit no Compose (portas 51025/58025), Redis com `maxmemory-policy noeviction`; novas variáveis em `.env.example` e validação em `loadConfig`                                                                                                                                                           | —          | `pnpm infra:up` healthy; `env.spec.ts` cobre novas variáveis (segredos ≥ 32 bytes)                                                      | [x]    |
| T2  | `libs/backend/shared/kernel`: `DomainError`, `Clock`, `IdGenerator`, `EmailAddress` (+ testes)                                                                                                                                                                                                                         | —          | testes do kernel; lint de boundaries                                                                                                    | [x]    |
| T3  | `libs/backend/shared/application`: `RequestContext`, `TransactionRunner`, `OutboxWriter`, `IntegrationEvent`, `EmailSender`, `RateLimiter` (apenas tipos/portas)                                                                                                                                                       | T2         | typecheck; lint                                                                                                                         | [x]    |
| T4  | `libs/backend/shared/http`: mover `HttpError`/problem details de `apps/api`; mapeamento `DomainError`; `validateBody`; `requireCsrf` (Origin/Referer/Sec-Fetch-Site + double-submit assinado); `createRateLimit`; `createAuthenticate`; serializer de logs restrito; `ioredis`/`bullmq` banidos em `type:presentation` | T2, T3     | Supertest dos middlewares (CA-11); testes atuais da API continuam verdes                                                                | [x]    |
| T5  | `shared/infrastructure`: `PrismaTransactionRunner` (ALS) + `db()`, `PrismaOutboxWriter`, `UuidV7Generator`, `SystemClock`, `RedisRateLimiter` (com `insuranceLimiter`), `SmtpEmailSender`                                                                                                                              | T3         | integração: transação com rollback, outbox gravada na mesma transação, rate limiter com Redis real e com Redis parado, envio ao Mailpit | [x]    |
| T6  | Atualizar `docs/architecture/dependency-rules.md` e `overview.md` (shared/kernel, application, http)                                                                                                                                                                                                                   | T4         | revisão + verificação de links                                                                                                          | [x]    |

## Bloco B — Domínio e persistência de identidade

| ID  | Tarefa                                                                                                                                                                                                   | Depende de | Verificação                                                                                                      | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| T7  | `identity/domain`: `Password` (BR-011, NFC, sem truncamento), porta `CommonPasswordList`, `PersonName`, `User`, erros                                                                                    | T2         | testes BR-011 (cada regra), `User`                                                                               | [x]    |
| T8  | `identity/domain`: `Session.rotate` (BR-012 tolerância estrita, BR-015) e `UserToken`                                                                                                                    | T7         | testes com relógio controlado: rotacionar, tolerância única, reuso, outro cliente, expiração deslizante/absoluta | [ ]    |
| T9  | Schema Prisma + primeira migration (users, sessions, refresh_tokens, user_tokens; `outbox_events` antecipada na T5)                                                                                      | T5         | `/database-migration`: SQL revisado; `prisma migrate dev`; `migrate status`                                      | [ ]    |
| T10 | `identity/infrastructure`: repositórios Prisma (incl. `findByRefreshTokenHashForUpdate`), consumo atômico de token                                                                                       | T8, T9     | integração: CRUD, lock fora de transação falha, consumo concorrente de token (um vence)                          | [ ]    |
| T11 | `Argon2PasswordHasher` (semáforo, rehash), `FileCommonPasswordList` (lista embarcada + licença registrada), `JoseAccessTokens` (kid, algoritmos fixos), `RedisSessionRevocationList` (fallback ao banco) | T7, T5     | unit + integração (Redis parado → fallback)                                                                      | [ ]    |

## Bloco C — Casos de uso e API

| ID  | Tarefa                                                                                                                                                         | Depende de  | Verificação                                                                                                      | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| T12 | Casos de uso: `RegisterUser`, `Login`, `GetCurrentUser`, `Logout`                                                                                              | T10, T11    | testes com fakes (BR-014: Argon2 sempre; resposta igual; supressão por e-mail)                                   | [ ]    |
| T13 | Casos de uso: `RefreshSession`, `ListSessions`, `RevokeSession`                                                                                                | T12         | fakes + integração de refresh concorrente (CA-05)                                                                | [ ]    |
| T14 | Casos de uso: `ResendEmailVerification`, `ConfirmEmailVerification` (BR-017), `GetUserVerificationStatus`                                                      | T12         | fakes (CA-03, CA-16)                                                                                             | [ ]    |
| T15 | Casos de uso: `ChangePassword` (rotação da sessão atual), `RequestPasswordReset` (trabalho constante), `ResetPassword`                                         | T13         | fakes (CA-08, CA-09)                                                                                             | [ ]    |
| T16 | Contratos em `libs/contracts/auth`; `identity/http` routers `/auth` e `/me`; cookies; `Cache-Control: no-store`; wiring em `apps/api` (`createIdentityModule`) | T12–T15, T4 | Supertest: status, contratos, atributos de cookie, 401/404, CSRF, rate limit (CA-04, CA-07, CA-10, CA-11, CA-12) | [ ]    |
| T17 | Atraso progressivo por conta (BR-018) e limites por IP/e-mail conforme tabela                                                                                  | T16         | Supertest com Redis real (CA-10)                                                                                 | [ ]    |
| T18 | OpenAPI 3.1 com `zod-openapi`; `/api/docs` (Swagger UI) e `/api/docs/openapi.json` fora de produção                                                            | T16         | validação do documento (CA-15)                                                                                   | [ ]    |

## Bloco D — Worker e e-mails

| ID  | Tarefa                                                                                                                                                                                     | Depende de    | Verificação                                                                                                                         | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T19 | `apps/worker`: composition root, health (`WORKER_PORT`), graceful shutdown, `pnpm dev` sobe api + web + worker                                                                             | T5            | teste de health; start/stop limpo                                                                                                   | [ ]    |
| T20 | `OutboxRelay` (SKIP LOCKED, `addBulk` com `jobId`, `removeOnComplete` por idade)                                                                                                           | T19, T9       | integração PostgreSQL + Redis: publica uma vez; dois relays concorrentes não duplicam                                               | [ ]    |
| T21 | Casos de uso `SendEmailVerification`, `SendPasswordReset`, `SendAccountNotice` + templates pt-BR (sem conteúdo do usuário em contas não verificadas; HTML escapado) + mapeamento no worker | T20, T14, T15 | integração: e-mail no Mailpit; retry após falha SMTP gera novo link válido; worker parado → entrega ao voltar (CA-01, CA-02, CA-13) | [ ]    |
| T22 | `PurgeExpiredIdentityData` agendado (diário), incluindo contas não verificadas há > 7 dias (RF-15)                                                                                         | T19           | integração com dados expirados                                                                                                      | [ ]    |

## Bloco E — Frontend

| ID  | Tarefa                                                                                                                                                                 | Depende de   | Verificação                                          | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------- | ------ |
| T23 | Fonte Inter auto-hospedada; `Referrer-Policy: no-referrer` e CSP restrita (Nginx e dev server); `/status` movida                                                       | —            | build; headers verificados                           | [ ]    |
| T24 | `AuthStore`, bootstrap `/me`, CSRF (`withXsrfConfiguration`), interceptor de refresh single-flight com Web Locks e tratamento de 409, guards, validação de `returnUrl` | T16          | testes de store, interceptor (concorrência) e guards | [ ]    |
| T25 | Telas login e cadastro (requisitos de senha com `aria-live`, erros por `code`)                                                                                         | T24          | testes de formulário (CA-12)                         | [ ]    |
| T26 | Telas verificação de e-mail (fragmento, login preservando token, clique explícito), esqueci e redefinir senha                                                          | T24          | testes de componente (CA-03, CA-16)                  | [ ]    |
| T27 | Shell autenticado (menu do usuário, banner de verificação), home, página Segurança (sessões, troca de senha)                                                           | T24          | testes de componente                                 | [ ]    |
| T28 | E2E: jornada completa lendo e-mail pela API do Mailpit (CA-14); CI sobe Mailpit e worker                                                                               | T21, T25–T27 | `pnpm e2e`                                           | [ ]    |

## Bloco F — Fechamento

| ID  | Tarefa                                                                                                                                                     | Depende de | Verificação                                                              | Status |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------ | ------ |
| T29 | `/review-code` e `/security-audit` do conjunto; correções                                                                                                  | T1–T28     | sem bloqueantes / sem Críticos-Altos abertos                             | [ ]    |
| T30 | Docs: BR-011…BR-018 em `business-rules.md`; `docs/security/authentication.md`; setup (Mailpit, worker); ADRs 0005/0011 → Aceito; roadmap e índice de specs | T29        | verificação de links; `pnpm verify`, `pnpm test:integration`, `pnpm e2e` | [ ]    |

## Evidências

### T1 — 2026-10-08

- **Entregue**: Mailpit `v1.31` no Compose (SMTP `127.0.0.1:51025`, UI `127.0.0.1:58025`, healthcheck `readyz`); Redis com `--maxmemory-policy noeviction`; `infra:up` inclui Mailpit; `.env.example` com `APP_ORIGIN`, `AUTH_ACCESS_TOKEN_KEYS` (JSON entre aspas simples), `AUTH_ACCESS_TOKEN_ACTIVE_KID`, `CSRF_SECRET`, `LOG_PSEUDONYMIZATION_KEY`, `COOKIE_SECURE`, `PASSWORD_HASH_CONCURRENCY` (validadas em `loadConfig`) e `APP_URL`, `SMTP_URL`, `EMAIL_FROM`, `WORKER_PORT` (documentadas; validadas pelo worker na T19); variáveis no job E2E do CI.
- **Regras de validação**: segredos ≥ 32 bytes; `kid` com formato restrito e presente no mapa; `APP_ORIGIN` apenas origem; em produção, `COOKIE_SECURE=true` obrigatório e valores `dev-only` recusados; mensagens com nomes (e `kid`), nunca valores.
- **Testes**: `apps/api/src/config/env.spec.ts` — 13 testes (inclui regressão: `.env.example` válido em desenvolvimento e recusado em produção). `api` 26/26.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (5 projetos); `pnpm test:integration` 5/5; `pnpm e2e` 2/2; `pnpm format:check` ✔; `pnpm infra:up` → postgres, redis, mailpit `healthy`; `redis-cli CONFIG GET maxmemory-policy` → `noeviction`; e-mail SMTP de teste recebido via API do Mailpit.
- **Observação**: com o `.env` local antigo a API não inicia (lista `APP_ORIGIN`, `AUTH_ACCESS_TOKEN_KEYS`, `AUTH_ACCESS_TOKEN_ACTIVE_KID`, `CSRF_SECRET`, `LOG_PSEUDONYMIZATION_KEY`) — comportamento esperado; recriar a partir do exemplo.

### T2 — 2026-10-08

- **Entregue**: `libs/backend/shared/kernel` (`@taskflow/backend/shared/kernel`, tags `scope:backend`, `domain:shared`, `type:domain`) com `DomainError` (base abstrata com `code` estável e `name` da subclasse), `Clock`, `IdGenerator` (interfaces) e `EmailAddress` (trim + minúsculas; RFC 5321: ≤ 254 caracteres, parte local ≤ 64; erro `INVALID_EMAIL_ADDRESS` sem o valor recebido). Lib ajustada ao padrão do workspace (Vitest com `resolve.tsconfigPaths`, target `typecheck`).
- **Decisão tomada na implementação**: endereços internacionalizados (SMTPUTF8/IDN) **não** são suportados no MVP — validação somente ASCII; a normalização NFC prevista no design foi removida por não ter efeito. `design.md` atualizado.
- **Testes**: 21 (`email-address.spec.ts`, `domain-error.spec.ts`); cobertura 100% de linhas, ramos e funções.
- **Limites**: sondas temporárias confirmaram erros de lint para `type:domain → express`, `type:domain → type:infrastructure` e `scope:shared → scope:backend`; removidas, lint verde.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (6 projetos); `pnpm format:check` ✔.

### T3 — 2026-10-08

- **Entregue**: `libs/backend/shared/application` (`@taskflow/backend/shared/application`, tags `scope:backend`, `domain:shared`, `type:application`) com `RequestContext`/`Actor`, `TransactionRunner`, `IntegrationEvent` + `createIntegrationEvent` (id e instante injetados; evento e payload congelados), `JsonValue`, `OutboxWriter`, `EmailSender`/`EmailMessage` (destinatário como `EmailAddress` do kernel) e `RateLimiter`/`RateLimitPolicy`/`RateLimitDecision`.
- **Testes**: 3 (`integration-event.spec.ts`), incluindo verificação em tempo de compilação de que payloads não serializáveis (`Date`, funções) são rejeitados (`@ts-expect-error` validado pelo typecheck).
- **Limites**: sonda temporária confirmou erro de lint para `type:application → @prisma/client` e `type:application → type:infrastructure`; removida.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (7 projetos); `pnpm format:check` ✔.

### T4 — 2026-10-08

- **Entregue**: `libs/backend/shared/http` (`@taskflow/backend/shared/http`, tags `scope:backend`, `domain:shared`, `type:presentation`):
  - `HttpError` (com `violations` e `retryAfterSeconds`) e Problem Details **movidos de `apps/api`**; `createErrorHandler({ domainErrors })` mapeia `DomainError` por `code` (padrão 422, título genérico, sem mensagem técnica); `instance` sem query string; `requestId` incluído mesmo quando numérico (bug latente corrigido).
  - `parseBody(req, schema)` (validação Zod no controller, 400 `VALIDATION_FAILED` com violações sem valores).
  - `createAuthenticate({ cookieName, resolveActor, required })` + `requestContextFrom(req)`; extensão de tipos `Request.actor`.
  - `createCsrfProtection({ appOrigin, secret, secureCookie })`: `issue(res, binding)` (cookie `__Host-tf_csrf`, `Secure`, `SameSite=Strict`, `Path=/`, legível pelo SPA) e `require(resolveBinding?)` — `Sec-Fetch-Site`, `Origin`/`Referer`, double-submit em tempo constante, assinatura HMAC vinculada à sessão (ou `anon`); vínculo customizável para a rota de refresh (T16).
  - `createRateLimit({ limiter, policy, key })` (429 `RATE_LIMITED` + `Retry-After`) e `clientIpKey` (IPv4; IPv6 agregado por /64; respeita `trust proxy`).
  - `httpLogSerializers` (apenas id, método, caminho sem query, user agent; status) — aplicados no `pino-http` da API.
  - `ioredis` e `bullmq` adicionados aos imports proibidos de `type:presentation`.
- **Testes**: 35 na lib (CSRF 14 — CA-11; autenticação 5; rate limit/IP 5; erros e validação 9; serializers 2); cobertura 96% linhas / 91% ramos. API 26/26 após a migração.
- **Limites**: sonda temporária confirmou erro para `type:presentation → ioredis` e `→ type:infrastructure`; removida.
- **Verificação real**: API compilada recebendo `Cookie`, `X-CSRF-Token`, `X-Forwarded-For` e `?token=` com marcadores secretos → 0 ocorrências no log.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (8 projetos); `pnpm test:integration` 5/5; `pnpm e2e` 2/2; `pnpm format:check` ✔.

### T5 — 2026-10-08

- **Entregue** em `libs/backend/shared/infrastructure`: `PrismaTransactionRunner` (transação interativa, cliente corrente em `AsyncLocalStorage`, `client()`/`transactionalClient()`, aninhamento reutiliza a transação externa — sem savepoints —, timeout 5 s, espera de conexão 2 s); `PrismaOutboxWriter` (exige transação ativa); `UuidV7Generator` (`uuid` v14); `SystemClock`; `RedisRateLimiter` (`rate-limiter-flexible` 11, chaves `rate-limit:<policy>`, `rejectIfRedisNotReady` + `insuranceLimiter` em memória); `SmtpEmailSender` (`nodemailer` 10, URL `smtp:`/`smtps:` validada, timeouts de conexão/socket). Helper de teste `startPostgresTestDatabase()` exposto em `@taskflow/backend/shared/infrastructure/testing` (PostgreSQL 18 + `prisma migrate deploy`).
- **Reordenação**: modelo `OutboxEvent` e migration `20261008213749_add_outbox_events` criados aqui (infraestrutura compartilhada, não `identity`); SQL revisado + índice parcial manual `outbox_events_unpublished_idx`; `prisma migrate diff` confirma ausência de drift. T9 passa a conter só as tabelas de identidade.
- **Testes**: unitários 2 (UUID v7: formato, ordenação, unicidade em 1000). Integração 20 (antes 5): migrations reais + índice parcial; outbox gravada no commit e descartada no rollback (BR-010); aninhamento reutiliza o cliente externo (asserção confirmada falhando com regressão simulada); outbox fora de transação recusada; isolamento entre conexões; rate limiter com Redis real (limite, `Retry-After`, contador compartilhado entre instâncias, reset) e com Redis inacessível (limite em memória mantido); SMTP entregando no Mailpit, falha com servidor inacessível, URL não SMTP recusada.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔; `nx run backend-shared-infrastructure:integration-test` 20/20; `pnpm format:check` ✔; `prisma migrate dev` aplicado no banco local.

### T6 — 2026-10-08

- **Entregue**: `docs/architecture/dependency-rules.md` — tabela de importações proibidas alinhada exatamente ao `eslint.config.mjs` e nova seção "Bibliotecas compartilhadas do backend" (kernel, application, http, infrastructure e subcaminho `/testing`, com regra de inclusão). `docs/architecture/overview.md` — árvore do monorepo, estado implementado/planejado (worker antecipado pela T19/ADR 0011) e seção Backend (transações, outbox, mapeamento de `DomainError`, serializers de log).
- **Divergência corrigida**: a doc dizia que `type:contracts` só pode importar `zod`, mas o lint bloqueava apenas 4 pacotes. Lint fortalecido com `allowedExternalImports: ['zod']`; sonda temporária confirmou bloqueio de `pino` e aceitação de `zod`.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔; verificação de links em `docs/` ✔; `pnpm format:check` ✔.

### T7 — 2026-10-08

- **Entregue**: `libs/backend/identity/domain` (`@taskflow/backend/identity/domain`, tags `scope:backend`, `domain:identity`, `type:domain`):
  - `Password` (BR-011): NFC, sem truncamento, limites 8–128 em caracteres (code points), maiúscula/minúscula/dígito/símbolo por categorias Unicode, diferente do e-mail (case-insensitive), fora da `CommonPasswordList`; `PasswordPolicyViolationError` (`PASSWORD_POLICY_VIOLATION`) lista **todas** as regras violadas; texto puro só via `reveal()` — `toString`, `toJSON` e `util.inspect` retornam `[REDACTED]`.
  - Portas `CommonPasswordList` (síncrona) e `PasswordHasher` (`hash`, `verify` sem aplicar BR-011, `needsRehash`).
  - `PersonName` (NFC, espaços normalizados, 1–100 caracteres, sem caracteres de controle/formatação invisíveis — ex.: override bidirecional `U+202E`; `INVALID_PERSON_NAME`).
  - `User`: `register`, `restore`, `verifyEmail` (`EMAIL_ALREADY_VERIFIED`), `markEmailVerifiedByReset` (idempotente, RF-11), `changePassword`, `toSnapshot`.
- **Testes**: 29 (11 com prefixo `BR-011:`); cobertura 92% linhas / 100% ramos. Mutações (remoção da NFC; comparação com e-mail sensível a caixa) derrubaram exatamente os testes correspondentes. Dois testes frágeis corrigidos durante a revisão (asserção que podia passar sem exceção; caso de e-mail ilegível).
- **Lacuna de lint corrigida**: `type:domain` proibia apenas uma lista de pacotes de infraestrutura (ex.: `nodemailer` era permitido). Agora `allowedExternalImports: []` — sonda confirmou bloqueio de `nodemailer` e `zod`. Observação documentada: o Nx só verifica pacotes instalados e não verifica `node:*`. `dependency-rules.md` atualizado.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (9 projetos); `pnpm format:check` ✔.
