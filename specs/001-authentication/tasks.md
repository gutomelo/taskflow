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
| T8  | `identity/domain`: `Session.rotate` (BR-012 tolerância estrita, BR-015) e `UserToken`                                                                                                                    | T7         | testes com relógio controlado: rotacionar, tolerância única, reuso, outro cliente, expiração deslizante/absoluta | [x]    |
| T9  | Schema Prisma + primeira migration (users, sessions, refresh_tokens, user_tokens; `outbox_events` antecipada na T5)                                                                                      | T5         | `/database-migration`: SQL revisado; `prisma migrate dev`; `migrate status`                                      | [x]    |
| T10 | `identity/infrastructure`: repositórios Prisma (incl. `findByRefreshTokenHashForUpdate`), consumo atômico de token                                                                                       | T8, T9     | integração: CRUD, lock fora de transação falha, consumo concorrente de token (um vence)                          | [x]    |
| T11 | `Argon2PasswordHasher` (semáforo, rehash), `FileCommonPasswordList` (lista embarcada + licença registrada), `JoseAccessTokens` (kid, algoritmos fixos), `RedisSessionRevocationList` (fallback ao banco) | T7, T5     | unit + integração (Redis parado → fallback)                                                                      | [x]    |

## Bloco C — Casos de uso e API

| ID  | Tarefa                                                                                                                                                         | Depende de  | Verificação                                                                                                      | Status |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- | ------ |
| T12 | Casos de uso: `RegisterUser`, `Login`, `GetCurrentUser`, `Logout`                                                                                              | T10, T11    | testes com fakes (BR-014: Argon2 sempre; resposta igual; supressão por e-mail)                                   | [x]    |
| T13 | Casos de uso: `RefreshSession`, `ListSessions`, `RevokeSession`                                                                                                | T12         | fakes + integração de refresh concorrente (CA-05)                                                                | [x]    |
| T14 | Casos de uso: `ResendEmailVerification`, `ConfirmEmailVerification` (BR-017), `GetUserVerificationStatus`                                                      | T12         | fakes (CA-03, CA-16)                                                                                             | [x]    |
| T15 | Casos de uso: `ChangePassword` (rotação da sessão atual), `RequestPasswordReset` (trabalho constante), `ResetPassword`                                         | T13         | fakes (CA-08, CA-09)                                                                                             | [x]    |
| T16 | Contratos em `libs/contracts/auth`; `identity/http` routers `/auth` e `/me`; cookies; `Cache-Control: no-store`; wiring em `apps/api` (`createIdentityModule`) | T12–T15, T4 | Supertest: status, contratos, atributos de cookie, 401/404, CSRF, rate limit (CA-04, CA-07, CA-10, CA-11, CA-12) | [x]    |
| T17 | Atraso progressivo por conta (BR-018) e limites por IP/e-mail conforme tabela                                                                                  | T16         | Supertest com Redis real (CA-10)                                                                                 | [x]    |
| T18 | OpenAPI 3.1 com `zod-openapi`; `/api/docs` (Swagger UI) e `/api/docs/openapi.json` fora de produção                                                            | T16         | validação do documento (CA-15)                                                                                   | [x]    |

## Bloco D — Worker e e-mails

| ID  | Tarefa                                                                                                                                                                                     | Depende de    | Verificação                                                                                                                         | Status |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T19 | `apps/worker`: composition root, health (`WORKER_PORT`), graceful shutdown, `pnpm dev` sobe api + web + worker                                                                             | T5            | teste de health; start/stop limpo                                                                                                   | [x]    |
| T20 | `OutboxRelay` (SKIP LOCKED, `addBulk` com `jobId`, `removeOnComplete` por idade)                                                                                                           | T19, T9       | integração PostgreSQL + Redis: publica uma vez; dois relays concorrentes não duplicam                                               | [x]    |
| T21 | Casos de uso `SendEmailVerification`, `SendPasswordReset`, `SendAccountNotice` + templates pt-BR (sem conteúdo do usuário em contas não verificadas; HTML escapado) + mapeamento no worker | T20, T14, T15 | integração: e-mail no Mailpit; retry após falha SMTP gera novo link válido; worker parado → entrega ao voltar (CA-01, CA-02, CA-13) | [x]    |
| T22 | `PurgeExpiredIdentityData` agendado (diário), incluindo contas não verificadas há > 7 dias (RF-15)                                                                                         | T19           | integração com dados expirados                                                                                                      | [x]    |

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

### T8 — 2026-10-08

- **Entregue** em `libs/backend/identity/domain`:
  - `Session` (agregado): `start` (inatividade 7 d limitada ao absoluto de 30 d), `rotate` com resultado explícito `rotated | grace | reuse_detected | expired | revoked` (BR-012: tolerância só para o predecessor imediato, uma vez, ≤ 5 s, mesmo prefixo de IP e user agent; qualquer outro token da sessão revoga com `reuse_detected`), deslize da inatividade a cada uso sem ultrapassar o absoluto (BR-015), `revoke` idempotente preservando o primeiro motivo, cliente atualizado a cada rotação.
  - Erros `SESSION_REVOKED`, `SESSION_EXPIRED`, `REFRESH_IN_PROGRESS` (usados pelos casos de uso na T13).
  - `UserToken`: validade por finalidade (verificação 24 h, redefinição 30 min), uso único, finalidade verificada no consumo, `sourceEventId` para idempotência; um único erro `INVALID_OR_EXPIRED_TOKEN` para todas as falhas (sem oráculo).
- **Testes**: domínio de identidade agora com 56 testes (T8: 27, com prefixos `BR-012:`/`BR-015:`), relógio controlado; cobertura 100% linhas, ramos e funções.
- **Mutação**: 7 mutações em `session.ts` (tolerância reutilizável, janela ampliada, sem checar IP, sem checar user agent, deslize sem teto, reuso sem revogar, sem expiração absoluta). As 6 primeiras foram detectadas de imediato; a última sobreviveu por ser redundante sob a invariante "inatividade ≤ absoluto" — adicionado teste com estado persistido inconsistente, que passou a detectá-la.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (9 projetos); `pnpm format:check` ✔.

### T9 — 2026-10-08

- **Entregue**: modelos `User`, `Session`, `RefreshToken`, `UserToken` e enums `session_revocation_reason`/`user_token_purpose`; migration `20261008234846_add_identity_tables` gerada com `--create-only`, SQL revisado (somente `CREATE`; nenhum `DROP`/`ALTER` destrutivo; FKs com `ON DELETE CASCADE` a partir de `users`) e complementada com restrições manuais: e-mail normalizado, inatividade ≤ absoluto, revogação consistente, **um refresh token atual por sessão** (índice único parcial — BR-012 no banco), tolerância só após rotação, validade de token posterior à criação, índice parcial de não verificados (RF-15).
- **Verificação**: `prisma migrate dev` aplicado; `prisma migrate diff` vazio (sem drift); `prisma migrate status` "up to date"; 10 cenários SQL em transações revertidas — 2 aceitos (válido, rotação legítima) e 8 rejeitados pela restrição esperada (inclui cascata ao remover usuário). Os mesmos cenários serão automatizados nos testes de integração dos repositórios (T10).
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (9 projetos); `pnpm test:integration` 20/20 (aplica ambas as migrations do zero); `pnpm format:check` ✔.

#### T9 — adendo: schema Prisma multi-arquivo (pedido do usuário, 2026-10-08)

- `prisma/schema.prisma` passa a conter só `generator`/`datasource`; modelos em `prisma/models/identity.prisma` (bounded context Identity & Access) e `prisma/models/shared.prisma` (outbox). `prisma.config.ts` aponta para o **diretório** `prisma` (apontar para o arquivo faria o `generate` ignorar os modelos silenciosamente).
- **Equivalência comprovada**: `prisma validate` ✔; client regenerado com os mesmos 5 modelos e `models.ts` idêntico byte a byte; `prisma migrate diff` (banco × schema) vazio; `migrate status` "up to date"; `pnpm test:integration` 20/20 aplicando as migrations do zero.
- **Ajustes decorrentes**: input de cache do target `prisma-generate` passou de `prisma/schema.prisma` para `prisma/**/*.prisma` (verificado: editar `models/identity.prisma` invalida o cache); regra `database.md` (estrutura por contexto + proibição de relações entre contextos), skill `database-migration`, agente `database-specialist`, mensagem do hook de arquivos gerados, template `technical-plan.md` e `overview.md` atualizados.

### T10 — 2026-10-08

- **Contratos** (domínio): `UserRepository`, `SessionRepository`, `UserTokenRepository`; erro `EmailAlreadyRegisteredError` (identity) e `VersionConflictError` (`VERSION_CONFLICT`, kernel — ADR 0006).
- **Implementações** em `libs/backend/identity/infrastructure` (`domain:identity`, `type:infrastructure`): `PrismaUserRepository` (unicidade → erro de domínio; `save` com optimistic locking), `PrismaSessionRepository` (`findByRefreshTokenHashForUpdate` com `SELECT … FOR UPDATE OF s` e exigência de transação; carga do token atual + predecessor numa única consulta, sem N+1; `save` atualiza o predecessor antes de inserir o novo atual; `revokeAllForUser` com `UPDATE … RETURNING`), `PrismaUserTokenRepository` (`consume` atômico com `UPDATE … RETURNING`; `upsertForEvent` substitui hash/validade no retry **sem reativar token consumido**; `invalidatePending`). Lib compartilhada ganhou `isUniqueConstraintViolation` e tipos `*Row`.
- **Testes**: 24 de integração (PostgreSQL real): round-trips; cadastro concorrente (um vence); conflito de versão; lock determinístico (B bloqueia enquanto A segura o lock e depois recebe `grace`); renovações concorrentes nunca rotacionam duas vezes; reuso de outro cliente revoga; revogação em massa com exceção; consumo único sob 5 consumos concorrentes; expirado/outra finalidade indistinguíveis; retry substitui link; reentrega não reativa; invalidação por finalidade; cenários de restrição da T9 automatizados (token atual duplicado, e-mail não normalizado, revogação inconsistente, inatividade além do absoluto, token nascido expirado, cascata).
- **Prova dos testes**: sem `FOR UPDATE`, o teste de lock falha (o primeiro teste com `Promise.all` passava mesmo sem lock e foi substituído por intercalação determinística); mutações no consumo (sem `consumed_at IS NULL`, sem checar expiração) e no retry (reativando consumido) foram todas detectadas.
- **Correções durante a tarefa**: decisão revista no `upsertForEvent` (não reativar token consumido); fixtures de teste movidos para `src/testing/` (excluídos do build e incluídos no `tsconfig.spec.json` — necessário para os aliases no Vitest); teste sem valor removido.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (10 projetos); `pnpm test:integration` 20 + 24 ✔; `pnpm format:check` ✔.

### T11 — 2026-10-08

- **Portas** (nova lib `libs/backend/identity/application`, criada antecipadamente só com interfaces): `AccessTokenIssuer`, `AccessTokenVerifier` (`ignoreExpiration` restrito ao vínculo CSRF do refresh), `SessionRevocationList`. Em `shared/application`: `ServiceBusyError` (`SERVICE_BUSY`), mapeado para 503 + `Retry-After` no error handler (teste incluído).
- **Implementações** em `libs/backend/identity/infrastructure/src/lib/security`:
  - `Argon2PasswordHasher` (`argon2` 0.45, Argon2id m=19456/t=2/p=1, NFC na verificação, hash malformado ⇒ `false`, `needsRehash` também para variante não-Argon2id/legado) com `ConcurrencyLimiter` (semáforo com espera limitada ⇒ `ServiceBusyError`).
  - `FileCommonPasswordList`: asset `assets/common-passwords.txt` — 97.745 senhas (NCSC top 100k via SecLists, **MIT**), normalizadas (NFC, minúsculas, sem duplicatas/controle); procedência, licença e SHA-256 da origem em `common-passwords.NOTICE.md`; lista vazia impede o start.
  - `JoseAccessTokens` (`jose` 6): HS256 fixo, `kid` obrigatório de mapa fixo (rotação com chave anterior), `iss`/`aud`/`sub`/`sid`/`iat`/`exp` exigidos, 5 s de tolerância; `ignoreExpiration` aproveita apenas `JWTExpired` (payload já autenticado).
  - `RedisSessionRevocationList` (TTL 20 min, `MULTI` em lote): gravação falha alto; leitura recorre a `PrismaSessionRepository.isRevoked` (inexistente conta como revogada) quando o Redis falha.
- **Dependências**: `argon2` com `allowBuilds: false` — binário pré-compilado (inclui `linux-x64`/`arm64` glibc **e musl**, necessário para a imagem Alpine) verificado funcionando sem compilação nativa; `jose`.
- **Testes**: 27 unitários (limitador; Argon2 com biblioteca real — formato/parâmetros, sal, NFC, rehash, saturação; lista real com variante `Password1!` rejeitada pelo domínio; JWT — expiração e tolerância, rotação de chave, 7 ataques: payload adulterado, `alg=none`, outro segredo, `kid` desconhecido, HS512, outra audiência, lixo) + 29 de integração (lista de revogação com Redis real, TTL, fallback ao banco, falha de gravação; `isRevoked` no PostgreSQL).
- **Mutação**: algoritmo não fixado, relevar qualquer erro de claim com `ignoreExpiration` e gravação de revogação silenciosa — todas detectadas.
- **Pendências registradas para a T16**: copiar o asset da lista para `dist/apps/api` e passar o caminho pelo composition root; validar o carregamento do `argon2` na imagem Alpine (`docker build` da API) quando ele passar a ser importado.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (11 projetos); integração da lib 29/29; `pnpm format:check` ✔.

### T12 — 2026-10-08

- **Casos de uso** (`libs/backend/identity/application`): `RegisterUserUseCase` (RF-01/02, BR-011, BR-014: hash Argon2 **sempre antes** de consultar a conta, mesma resposta para conta existente com aviso no lugar do link, corrida de cadastro tratada como existente, supressão silenciosa de e-mails por endereço via `EmailDeliveryThrottle` — 1/10 min e 5/dia, chave pseudonimizada), `LoginUseCase` (RF-05, verificação contra hash fictício sem conta/e-mail malformado, `INVALID_CREDENTIALS` único, sessão com hash do refresh, cliente minimizado — IPv4 /24, IPv6 /64, user agent ≤ 256 —, rehash transparente tolerando só `VERSION_CONFLICT`), `GetCurrentUserUseCase` (RF-12; usuário removido ⇒ `SESSION_REVOKED`), `LogoutUseCase` (RF-07, por sessão ou por refresh token, idempotente, revogação na lista **antes** do commit).
- **Apoio**: domínio ganhou a porta `SecretTokenGenerator`, `Password.fromVerifiedCredential` (só para rehash, sem BR-011) e `User.rehashPassword` (não altera `passwordChangedAt`); `Pseudonymizer` (`shared/application`) + `HmacPseudonymizer` (`shared/infrastructure`); `CryptoSecretTokenGenerator` (256 bits, SHA-256 hex) na infraestrutura; `InvalidCredentialsError`, `CurrentUserView`, `toSessionClient`, tipos de eventos e políticas de entrega.
- **Fakes reutilizáveis** em `src/testing/identity-fakes.ts` (excluídos do build e da cobertura), incluindo `FakeTransactionRunner` com rollback real do estado em memória.
- **Testes**: 34 na aplicação (100% linhas, 96% ramos), + domínio 58, `HmacPseudonymizer` 3, `CryptoSecretTokenGenerator` 2. Destaques: rollback do usuário quando a outbox falha (BR-010), revogação desfeita quando a lista de revogação falha (RNF-08), chave do throttle sem e-mail em claro.
- **Mutação**: pular o hash para conta existente e remover a verificação fictícia do login — ambas detectadas (a segunda só após corrigir a aplicação da mutação, que inicialmente não casou com o código formatado pelo Prettier).
- **Correção durante a tarefa**: o fake de hash continha o token bruto (`sha256(token)` literal) e gerava falso positivo; passou a usar SHA-256 real.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (11 projetos); `pnpm format:check` ✔.

### T13 — 2026-10-08

- **Casos de uso**: `RefreshSessionUseCase` (RF-06, BR-012, BR-015 — sessão bloqueada durante a decisão; o resultado é gravado e **só após o commit** convertido em erro: `REFRESH_IN_PROGRESS` para tolerância, `SESSION_REVOKED` para reuso/revogada/desconhecida, `SESSION_EXPIRED`; no reuso, a sessão entra na lista de revogação antes do commit), `ListSessionsUseCase` (RF-08 — ativas do próprio usuário, `device: { browser, os }`, `isCurrent`, sem IP/tokens), `RevokeSessionUseCase` (RF-08 — sessão de outro usuário ou inexistente ⇒ `SESSION_NOT_FOUND`, idempotente).
- **Novos**: porta `SecurityEventRecorder` (eventos `auth.refresh_grace_hit`, `auth.refresh_reuse_detected`, `auth.session_revoked`, só identificadores), `SessionNotFoundError`, `summarizeUserAgent`. **Contrato ajustado** no design: `SessionSummary.device` estruturado no lugar de `userAgentLabel` (texto composto no frontend — i18n).
- **Testes**: aplicação 54 (refresh 8, listagem/revogação 6, user agent 7, demais anteriores); integração +4 com PostgreSQL, JWT e tokens reais (CA-05: duas abas simultâneas ⇒ uma renova, outra recebe `REFRESH_IN_PROGRESS`, ninguém deslogado e um único token atual; token rotacionado funciona na sequência; replay após 5 s revoga no banco e bloqueia o access token).
- **Comportamento consequente fixado em teste**: três renovações simultâneas do mesmo token ⇒ a terceira é reuso e revoga a sessão (tolerância de uso único). Dependência explícita da serialização entre abas no frontend (T24); registrado no design.
- **Mutação**: lançar `RefreshInProgressError` dentro da transação (perdendo a marca de tolerância) derrubou os 2 testes de tolerância.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (11 projetos); `pnpm test:integration` 20 + 33 ✔; `pnpm format:check` ✔.

### T14 — 2026-10-08

- **Casos de uso**: `ResendEmailVerificationUseCase` (RF-04 — já verificado ⇒ `EMAIL_ALREADY_VERIFIED`; excesso por endereço suprimido em silêncio), `ConfirmEmailVerificationUseCase` (RF-03, **BR-017** — ordem: já verificado ⇒ 409 sem tocar no token; token de outra conta ⇒ `TOKEN_BELONGS_TO_ANOTHER_ACCOUNT` **sem consumir**; inválido/expirado/outra finalidade ⇒ `INVALID_OR_EXPIRED_TOKEN`; senão consumo + verificação na mesma transação), `GetUserVerificationStatusUseCase` (BR-013, para a porta da spec 002).
- **Repositório**: `UserTokenRepository.findOwner` (dono de token utilizável, sem consumir) e `consume(..., { userId })` com a guarda de dono no próprio `UPDATE` (Prisma e fake).
- **Testes**: aplicação 66 (+12: confirmação 7 incluindo **CA-16** completo — vítima logada na própria conta não verifica a conta pré-sequestrada e o token permanece válido para o dono —, reenvio 4, status 1); integração 35 (+2: `findOwner` não consome; consumo recusado para outro usuário).
- **Mutação**: sem checagem de dono e sem nenhuma proteção BR-017 — ambas detectadas.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔; integração de `backend-identity-infrastructure` 35/35; `pnpm format:check` ✔.

### T15 — 2026-10-08

- **Casos de uso**: `ChangePasswordUseCase` (RF-09, BR-016 — exige a senha atual (`CURRENT_PASSWORD_INCORRECT`); Argon2 fora da transação; na transação: nova senha, **revogação de todas as sessões, inclusive a atual**, nova sessão para o solicitante (novos `sid`, refresh e access), revogações na lista antes do commit, links de recuperação pendentes invalidados, aviso por e-mail), `RequestPasswordResetUseCase` (RF-10, BR-014 — **não consulta a conta**; sempre registra o pedido com o e-mail normalizado; excesso por endereço suprimido), `ResetPasswordUseCase` (RF-11, BR-016 — BR-011 validada **antes** de consumir o link; consumo atômico condicionado ao dono; e-mail marcado como verificado; todas as sessões e demais links revogados; aviso por e-mail).
- **Novos**: `CurrentPasswordIncorrectError`; eventos de segurança `auth.password_changed` e `auth.password_reset_completed` (com contagem de sessões revogadas).
- **Testes**: aplicação 80 (+14: troca 4, pedido 3, redefinição 7 — inclusive rollback total e link preservado quando a revogação falha ou a senha é fraca).
- **Mutação**: troca de senha poupando a sessão atual e redefinição sem invalidar outros links — ambas detectadas (a primeira só após corrigir a aplicação da mutação, que inicialmente não casou com o código formatado).
- **Comandos**: `pnpm verify --skip-nx-cache` ✔; `pnpm format:check` ✔.

### T16 — 2026-10-09

- **Contratos** (`libs/contracts/auth`): requests `.strict()` com limites de tamanho (senha ≤ 1024 — protege o Argon2; tokens 16–256), `CurrentUser`, `SessionSummary` (datas ISO, `device` estruturado), `PasswordRule`.
- **`libs/backend/identity/http`** (`type:presentation`): `createIdentityRouter` com as 13 rotas do design (`/auth/*`, `/me`, `/me/password`, `/me/sessions`); `Cache-Control: no-store` em todas; autenticação opcional no router para o vínculo CSRF; refresh e logout com vínculo CSRF pela sessão do access token **mesmo expirado** (`ignoreExpiration`); CSRF reemitido no login e na troca de senha (novo `sid`); logout/revogação da sessão atual com `Clear-Site-Data: "cookies"`; refresh com sessão inválida limpa cookies; logs `auth.login_succeeded`/`auth.login_failed` (e-mail pseudonimizado); cookies `__Host-tf_at` (Lax, `/`) e `__Secure-tf_rt` (Strict, `/api/v1/auth`), sempre `HttpOnly`+`Secure`; `identityErrorMappings` (pt-BR) com `violations` das regras de senha.
- **`shared/http`**: mapeamento de `DomainError` aceita extrator de `violations`; referência de tipos do `pino-http` movida para o `index.ts` (antes não chegava aos consumidores).
- **`apps/api`**: `modules/identity.module.ts` (composition root do contexto — o design previa na infraestrutura, mas a infraestrutura não pode importar `http`); `createApp` recebe `apiRouters` e `domainErrors`; asset da lista de senhas copiado para `dist/apps/api/assets`; hash fictício calculado no start.
- **Decisões**: `COOKIE_SECURE` removido (prefixos `__Host-`/`__Secure-` exigem `Secure`; localhost é contexto seguro); limites por endpoint ficam integralmente na T17.
- **Bugs encontrados na execução real e corrigidos**: (1) Redis conectava só no primeiro comando — com fila offline desligada, revogação caía no fallback do banco e o rate limit ficava em memória; agora `main.ts` conecta no start (sem impedir o start se o Redis estiver fora). (2) Imagem Docker: `pnpm install --prod` falhava porque o `pnpm-workspace.yaml` gerado não tem `allowBuilds` (argon2 ⇒ `ERR_PNPM_IGNORED_BUILDS`); o Dockerfile passa a usar a política do workspace. (3) Serviço `api` do Compose sem as variáveis da T1 — adicionadas (valores `dev-only`, `NODE_ENV=test`).
- **Testes**: HTTP 21 (Supertest com casos de uso reais sobre fakes): atributos de cookies (CA-04), corpo 401 idêntico para senha errada e e-mail inexistente, CSRF inclusive no login (CA-11), rotação do CSRF no login, `/me` e logout com bloqueio imediato do access token antigo (CA-07), refresh com access expirado e reuso revogando com limpeza de cookies (CA-05/06), cadastro 202 idêntico, violações de senha estruturadas (CA-12), mass assignment ⇒ 400, link de outra conta ⇒ 403 (CA-16), sessões 404 para id malformado/alheio, revogar a atual = logout, troca de senha com novos cookies (CA-09), recuperação (CA-08). `shared/http` 37; contratos 5.
- **Execução real**: API compilada com PostgreSQL/Redis (curl: cadastro, senha comum 422, login 401/200, `/me`, sessões, refresh, logout, `/me` 401; outbox e chaves no Redis conferidas). **Imagem Alpine**: `argon2` musl carregado (hash `$argon2id$v=19$m=19456,p=1,t=2`), lista embarcada (`Password1!` ⇒ `common_password`), usuário `node`, readiness ok.
- **Mutação**: login sem rotacionar CSRF ⇒ 10 testes falham.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (12 projetos); `pnpm test:integration` 20 + 35 ✔; `pnpm e2e` 2/2 ✔; `pnpm format:check` ✔.
- **Ambiente**: a validação Docker foi interrompida por disco cheio (liberado pelo usuário); removidas apenas as imagens criadas nesta sessão.

### T17 — 2026-10-09

- **BR-018**: política pura `requiredLoginDelaySeconds`/`remainingLoginDelaySeconds` (livre até 5 falhas; depois 1, 2, 4… s, teto 15 min — sem bloqueio permanente) em `identity/application`; porta `LoginAttemptTracker` + `RedisLoginAttemptTracker` (hash com falhas e último instante, TTL 24 h, fallback em memória); `LoginUseCase` checa **antes** do Argon2, registra falha só em `INVALID_CREDENTIALS` e zera no sucesso; chave pelo e-mail normalizado pseudonimizado (contas inexistentes tratadas igual).
- **Erro genérico** `RateLimitedError` (`shared/application`) ⇒ 429 `RATE_LIMITED` + `Retry-After` no error handler.
- **Limites por endpoint** (`IDENTITY_RATE_LIMITS`, `identity/http`): cadastro 5/h IP; login 30/15 min IP; refresh 60/min por refresh pseudonimizado; confirmar 20/h e reenviar 3/h por usuário; esqueci a senha 3/h por e-mail (antes de qualquer consulta) e 10/h por IP; redefinir 10/h IP; trocar senha 5/h por usuário. Ligados no composition root com `RedisRateLimiter`.
- **Testes**: política 12; login BR-018 5 (inclui "nenhum `verify` durante a espera" e conta inexistente); tracker Redis 3 (integração: TTL, compartilhamento entre instâncias, fallback); HTTP 4 novos (CA-10: 6º cadastro por IP ⇒ 429 com `Retry-After: 3600`; esqueci a senha por e-mail com IPs diferentes; 6º login com senha certa ⇒ 429 `Retry-After: 1`; troca de senha por usuário). Erro 429 no `shared/http`.
- **Execução real** (API + PostgreSQL + Redis): cadastros 202×5 → 429; 5 logins 401 → senha certa 429 (`Retry-After: 1`) → após 1 s 200; contadores em `rate-limit:*` no Redis; contador de falhas zerado no sucesso. Observação: foi executado `FLUSHDB` no Redis **local de desenvolvimento** antes da verificação (apenas dados efêmeros de teste).
- **Mutação**: remoção da checagem de BR-018 ⇒ 3 testes falham; remoção do limite de cadastro por IP ⇒ 1 teste falha.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (12 projetos); `pnpm test:integration` 20 + 38 ✔; `pnpm e2e` 2/2 ✔; `pnpm format:check` ✔.

### T18 — 2026-10-09

- **Entregue**: documento OpenAPI 3.1 gerado com `zod-openapi` 6 a partir dos schemas de `@taskflow/contracts` (fonte única: os mesmos schemas validam as requisições). `shared/http`: `createApiDocument` (esquemas de segurança `sessionCookie` e `csrfToken`, componente `ProblemDetails`), `problemResponse`, `SECURITY`, `createApiDocsRouter` (Swagger UI via `swagger-ui-dist` estático + inicializador em arquivo — **sem script inline**, compatível com a CSP do Helmet; roteamento `strict` para `/docs` × `/docs/`). `identity/http`: `identityOpenApiPaths` (13 rotas com status de sucesso e erros, segurança por operação) e `identityOpenApiSchemas`. `apps/api`: `healthOpenApiPaths`, `createTaskflowApiDocument`; `/api/docs/` e `/api/docs/openapi.json` montados **apenas fora de produção** (RF-14).
- **Dependências**: `zod-openapi`, `swagger-ui-dist`; dev: `@readme/openapi-parser` (validação 3.1). Script de instalação do `@scarf/scarf` (telemetria do swagger-ui-dist) bloqueado em `allowBuilds`.
- **Testes** (`apps/api/src/openapi.spec.ts`, 5): documento válido pelo `@readme/openapi-parser` (CA-15); todas as 13 rotas de identidade presentes; erros como `application/problem+json` e esquemas de segurança; documento, página, bundle e inicializador servidos com CSP `script-src 'self'`; ausência em produção. Sanidade do validador: documento com parâmetro de path não declarado ⇒ `valid = false`.
- **Verificação em navegador** (Chrome DevTools): Swagger UI renderiza as 15 operações, "Authorize" e schemas; nenhum erro de CSP; único 404 é `favicon.ico` (pedido automático do navegador).
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (12 projetos); `pnpm format:check` ✔.

### T19 — 2026-10-09

- **Entregue**: `apps/worker` (`scope:backend`, `type:app`), alinhado à API: esbuild com bundle CJS, `typecheck`, Vitest com `resolve.tsconfigPaths`, sem os targets `prune*` do gerador. Composition root (`main.ts`): `.env` fora de produção, logger `taskflow-worker`, Prisma, Redis conectado no start (indisponibilidade não impede o start), servidor de health e desligamento limpo (SIGTERM/SIGINT, timeout de 10 s; `quit` × `disconnect` conforme o estado do Redis). Health em `node:http`, sem Express: `GET|HEAD /health/live` e `/health/ready` (PostgreSQL + Redis), com os contratos da API, `Cache-Control: no-store`, 404/405 e erros de probe só no log. Porta ocupada ou config inválida ⇒ saída 1 com mensagem em stderr, sem valores de variáveis.
- **Config do worker** (`loadWorkerConfig`): `WORKER_HOST` (padrão `0.0.0.0`), `WORKER_PORT` (3334), `APP_URL` (só a origem; **https obrigatório em produção**, pois os links carregam tokens), `SMTP_URL` (`smtp:`/`smtps:`), `EMAIL_FROM` (`Nome <e-mail>` ou endereço; quebras de linha recusadas para evitar injeção de cabeçalho). Isso fecha a pendência da T1. `WORKER_HOST` foi adicionado ao `.env.example`.
- **Refatoração (sem mudança de comportamento na API)**: para não duplicar código de segurança, foram movidos para `libs/backend/shared/infrastructure` (com `git mv`) `checkReadiness` (tipos estruturais compatíveis com `ReadinessReport`, porque a infraestrutura não importa `libs/contracts`) e `createLogger` (agora recebe `service`; mesma lista de redação). Também foi criado `lib/config/environment.ts` (`baseEnvironmentShape`, `portSchema`, `originSchema`, `parseEnvironment`, `InvalidConfigurationError`); `apps/api/src/config/env.ts` compõe a partir dele.
- **`pnpm dev`**: `nx run-many -t serve -p api web worker`. O inspector do worker usa a porta 9230 (a API fica com a 9229, como no `.vscode/launch.json`). Antes, os dois disputavam a 9229 e a API ficava sem debugger.
- **Testes**: worker com 17 (`env.spec.ts` com 11 casos, inclusive `.env.example` válido e mensagens sem valores; `health-server.spec.ts` com 6 casos sobre servidor real em porta efêmera: live, ready, 503 sem vazar o erro, query string, 404, 405). `shared/infrastructure` com +5 (`parseEnvironment` ×2; `createLogger` ×2 — `service` e redação de `authorization`, `cookie`, `password`, `refreshToken`; nível). Os 4 testes de `checkReadiness` foram movidos junto. A API manteve os 31 testes (27 + 4 movidos).
- **Mutation testing** (mutação confirmada por diff/grep antes de ler o resultado): CRLF permitido no nome de `EMAIL_FROM` ⇒ 1 falha; exigência de https em produção removida ⇒ 1 falha; checagem de método removida ⇒ 1 falha. O caso de injeção de cabeçalho foi reescrito porque o original passava por outro motivo (texto depois do `>`).
- **Verificação manual** (build de produção + infra local): `live` 200; `ready` 200; Redis parado ⇒ `ready` 503 com `redis: down`; Redis de volta ⇒ 200; SIGTERM ⇒ "Shutting down" e saída 0. Config inválida ⇒ saída 1 listando `SMTP_URL` e `EMAIL_FROM`; porta ocupada ⇒ `EADDRINUSE` e saída 1. `pnpm dev` ⇒ API, worker e web (proxy) respondendo 200 em cerca de 12 s, inspectors em 9229 e 9230; SIGINT no grupo ⇒ nenhum processo ou porta restante.
- **Observação de ambiente**: com o `.env` local antigo (`PORT=3333`), o dev server do Angular ocupa a porta 3333 (o Nx injeta o `.env` em todas as tarefas), e o `pnpm dev` não sobe a web na 4200. É o problema já documentado em `docs/development/setup.md`. A verificação usou `PORT=4200` no shell, sem alterar o `.env`.
- **Pendente (tarefas seguintes)**: serviço `worker` no Docker Compose/Dockerfile e job do worker no CI (T28); filas, relay e envio (T20–T22).
- **Docs**: `CLAUDE.md` (stack e `pnpm dev`), `docs/development/setup.md`, `docs/architecture/overview.md` (worker implementado, diagrama e observabilidade).
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (13 projetos, 334 testes unitários); `pnpm test:integration --skip-nx-cache` ✔ (58); `pnpm e2e --skip-nx-cache` ✔ (2); `pnpm format:check` ✔.

### T20 — 2026-10-09

- **Entregue** (`libs/backend/shared/infrastructure/src/lib/events`):
  - `OutboxRelay`: cada lote é uma transação curta no `PrismaTransactionRunner` (timeout de 5 s): `SELECT … WHERE published_at IS NULL AND type = ANY(tipos roteados) ORDER BY occurred_at, id LIMIT 50 FOR UPDATE SKIP LOCKED`, depois `publish`, depois `published_at = clock.now()`. Polling a cada 1 s; lotes cheios são drenados em sequência. Falhas são logadas e repetidas no ciclo seguinte. `stop()` aguarda o lote em andamento.
  - `BullMqEventPublisher` roteia por tipo para a fila e faz `addBulk` com `jobId = event.id`, `name = type` e `data = { eventId, type, occurredAt, payload }`.
  - `createEventQueue` aplica `OUTBOX_JOB_OPTIONS`: 5 tentativas, backoff exponencial de 5 s, `removeOnComplete { age: 86400 }`, `removeOnFail { age: 604800 }`.
- **Refinamento do design**: o relay só lê os tipos que o publicador sabe rotear. Eventos de um produtor mais novo ficam pendentes até um worker que os conheça, sem bloquear o lote (deploy gradual). Sem esse filtro, 50 eventos sem rota travariam a fila inteira.
- **Worker**: a fila `emails` recebe os 4 tipos de `IdentityEventType` (`apps/worker/src/queues/email-queue.ts`). O relay inicia depois do health. No desligamento, ele para antes de fechar fila, banco e Redis. O listener de `error` da fila é obrigatório e fica em `debug`, porque o cliente Redis já registra a falha de conexão.
- **Dependência**: `bullmq` 6.3.11. Os peers (`ioredis`, `pg`, `redis`, `bullmq-otel`) são todos opcionais, e o ioredis 6 do projeto atende `>=5`. Não há script de instalação novo (`msgpackr-extract` já estava bloqueado). API conferida na documentação da 6.3.11 via Context7: `jobId` duplicado é ignorado; IDs sem `:` e não numéricos; fail-fast recomendado para produtores.
- **Testes de integração** (`outbox-relay.integration.spec.ts`, PostgreSQL 18 + Redis 8 via Testcontainers, 6 casos):
  - publica cada evento uma vez, com `jobId`, dados e opções corretos;
  - **dois relays concorrentes**, com clientes Prisma distintos, recebem lotes disjuntos (50 + 70, sem interseção, 120 jobs). O primeiro segura o lock de forma determinística enquanto o segundo drena;
  - falha na publicação mantém o lote pendente;
  - republicação após commit perdido não duplica jobs;
  - tipos sem rota ficam pendentes sem bloquear;
  - o polling continua até `stop()`.
- **Mutation testing** (mutação confirmada antes de ler o resultado; arquivos restaurados e conferidos com `grep`):
  - sem `FOR UPDATE SKIP LOCKED` ⇒ falha o teste de concorrência;
  - só `FOR UPDATE` ⇒ falha o teste de concorrência por timeout de 5 s;
  - sem `jobId` ⇒ 2 falhas;
  - sem filtro de tipo ⇒ falha o teste de tipos sem rota;
  - marcar sem publicar ⇒ 5 falhas.
- **Smoke test manual** (build de produção; banco descartável `taskflow_smoke` e índice 1 do Redis, **sem alterar o banco local**; os 8 eventos foram copiados dele):
  - 8 eventos reais da API viram 8 jobs na fila `emails`, com `jobId` = id do evento e as opções acima;
  - `published_at` zerado ⇒ republicados, e a fila continua com 8 jobs;
  - Redis parado ⇒ o processo continua vivo e o evento fica pendente; Redis de volta ⇒ publicado em cerca de 4 s;
  - SIGTERM ⇒ saída 0;
  - banco descartável removido e chaves do índice 1 apagadas depois do teste.
- **Docs**: `docs/architecture/data-flow.md` (seção 4: fluxo implementado da outbox, garantias e falhas; antes estava como "Fase 4 — se justificado") e `docs/architecture/overview.md` (Backend → Outbox).
- **Pendente**: consumidor da fila `emails` (T21); métrica do atraso da outbox (Fase 4). Com o Redis fora, o relay registra um `error` por segundo; o alerta e a métrica ficam para a Fase 4.
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (13 projetos, 334 testes unitários); `pnpm test:integration --skip-nx-cache` ✔ (64); `pnpm e2e --skip-nx-cache` ✔ (2); `pnpm format:check` ✔.

### T21 — 2026-10-09

- **Entregue**:
  - **Aplicação**: `SendEmailVerificationUseCase`, `SendPasswordResetUseCase` e `SendAccountNoticeUseCase`. Os dois primeiros emitem o token **por evento** (`upsertForEvent`, novo a cada tentativa) **antes** de enviar. Porta `IdentityEmailTemplates`. Links com o token no fragmento (`APP_URL/verify-email#token=…`, `/reset-password#token=…`). Resultado `EmailDeliveryOutcome` (`sent` ou `discarded` com motivo) para log, sem e-mail nem token.
  - **Infraestrutura (identity)**: `ptBrIdentityEmailTemplates`, com texto e HTML gerados dos mesmos blocos; `escapeHtml` em todo dado dinâmico, inclusive atributos `href`; assuntos sem dados do usuário; HTML sem recursos externos.
  - **Worker**: `createEmailDelivery` (relay → fila `emails` → consumidor → casos de uso), usado pelo `main.ts` e pelo teste de integração. `createEmailJobProcessor` valida o job com Zod (envelope e payload por tipo); job inválido ⇒ `UnrecoverableError`, sem retry. Logs com `eventId` como correlação; falha final ⇒ `error`, intermediária ⇒ `warn`. `describeJobError` omite a mensagem de erros SMTP/rede, que pode conter endereços.
  - **Shared/infrastructure**: `createEventWorker`, com conexão própria (`maxRetriesPerRequest: null`, exigido pelo `Worker` do BullMQ; `close()` aguarda os jobs ativos e fecha a conexão). `createEventQueue` aceita sobrescrever opções dos jobs (testes usam backoff curto).
  - **Desligamento**: consumidor e relay param primeiro e aguardam o trabalho em andamento; depois SMTP, health, Prisma e Redis. Falhas de qualquer etapa entram no log e no código de saída.
- **Decisões tomadas na implementação**:
  - **Conta não verificada recebe saudação genérica** em todos os e-mails, porque o nome pode ter sido escolhido por quem cadastrou o endereço de outra pessoa. Contas verificadas são saudadas pelo nome.
  - **`UserTokenRepository.upsertForEvent` passa a devolver `'issued' | 'already_consumed'`** (domínio, Prisma e fake). Se o link do evento já foi usado (reentrega após envio confirmado), o caso de uso descarta o envio em vez de mandar um link morto.
  - Avisos sem token podem chegar duplicados num retry após envio bem-sucedido. Isso já era aceito pelo design.
- **Testes**:
  - aplicação +11 (`send-identity-emails.use-cases.spec.ts`): CA-01, saudação genérica, retry com novo link (só o último vale), um token por evento (CA-13), não envia link morto, descartes por conta inexistente ou já verificada e por e-mail inválido, reset de 30 min com finalidade correta, CA-02 sem token, aviso de senha alterada;
  - infraestrutura +5 (templates e escape);
  - worker +11 (`email-jobs.spec.ts`: 4 tipos despachados, 4 jobs inválidos sem retry, falha de envio propagada, `describeJobError` ×2);
  - integração do repositório: retorno de `upsertForEvent` asserido.
- **Integração ponta a ponta** (`apps/worker/src/email-delivery.integration.spec.ts`; novo target `worker:integration-test`; PostgreSQL 18 + Redis 8 + Mailpit 1.31 via Testcontainers; produtores reais `RegisterUserUseCase` e `RequestPasswordResetUseCase` sobre Prisma; SMTP real), 5 casos:
  - **CA-01**: o link chega ao Mailpit, o token pertence ao usuário e o nome do cadastro não aparece;
  - **retry após falha SMTP**: 2 tentativas, 1 e-mail, link da falha inválido e link entregue válido;
  - **CA-13**: com o worker parado, nada é enviado e o evento fica pendente; ao iniciar, exatamente 1 e-mail; a republicação pelo relay não duplica, e o reprocessamento direto mantém 1 token por evento;
  - **CA-02**: aviso sem token e uma única conta;
  - **reset**: link de 30 min válido para `password_reset`; endereço desconhecido ⇒ job concluído como `discarded/user_not_found` e nenhum e-mail.
- **Mutation testing** (diff confirmado em cada mutação; arquivos restaurados e conferidos com `grep`), 7 de 7 detectadas:
  - ignorar token já consumido ⇒ 1 falha;
  - nome em conta não verificada ⇒ 2 falhas;
  - sem escape de HTML ⇒ 3 falhas;
  - `userId` sem validação de UUID ⇒ 1 falha;
  - finalidade errada no reset ⇒ 1 falha;
  - token na query string em vez do fragmento ⇒ 4 falhas;
  - mensagem SMTP no log ⇒ 1 falha.
- **Não executado**: smoke test manual com `pnpm dev` (cadastro via HTTP → Mailpit). Ele gravaria usuários e tokens no banco local e processaria os 8 eventos pendentes ali. A integração acima cobre o worker com componentes reais; a jornada HTTP completa entra no E2E da T28 (CA-14).
- **Docs**: `docs/architecture/data-flow.md` (seção 4: consumidor, retry, token por evento, descartes e duplicidade aceita nos avisos).
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (13 projetos, 361 testes unitários); `pnpm test:integration --skip-nx-cache` ✔ (3 projetos, 69); `pnpm e2e --skip-nx-cache` ✔ (2); `pnpm format:check` ✔.

### T22 — 2026-10-09

- **Entregue**:
  - **Aplicação**: `PurgeExpiredIdentityDataUseCase` com prazos explícitos (`IDENTITY_RETENTION_DAYS`):
    - contas não verificadas: 7 dias sem login (RF-15);
    - sessões encerradas: 30 dias;
    - tokens de e-mail consumidos ou expirados: 7 dias.

    Remove as contas primeiro, e as sessões e tokens delas caem por cascata. Porta `IdentityDataRetention`.

  - **Infraestrutura (identity)**: `PrismaIdentityDataRetention`, SQL em lotes de 1.000 linhas (instruções autocommit, locks curtos):
    - sessão "encerrada" = revogada, expirada por inatividade ou expirada pelo limite absoluto;
    - na remoção de contas, o `DELETE` externo repete `email_verified_at IS NULL`, e o PostgreSQL reavalia a condição se a conta for verificada durante a limpeza.
  - **Shared/infrastructure**: `PrismaOutboxRetention`. Remove eventos publicados há mais de 7 dias, inclusive o payload de recuperação com e-mail; eventos pendentes nunca são removidos. `createEventWorker` passou a ser genérico no tipo do job.
  - **Worker** (`maintenance.ts`):
    - fila `maintenance` com job scheduler do BullMQ (`0 0 3 * * *`, `tz: UTC`): o `upsert` no start é idempotente, e com vários workers há uma única execução por ocorrência;
    - consumidor com concorrência 1; job com 3 tentativas (backoff exponencial de 60 s);
    - se o Redis estiver fora no start, o registro do agendamento é tentado de novo a cada 60 s;
    - o relatório da limpeza vai para o log `info`;
    - integrado ao `main.ts`, inclusive ao desligamento limpo.
- **Decisões tomadas na implementação**:
  - A limpeza da outbox ficou fora do contexto `identity`, porque a tabela é da `shared/infrastructure`. O design a listava dentro de `PurgeExpiredIdentityData`; ela roda no mesmo job diário.
  - "Sem login no período" (RF-15) = nenhuma sessão criada nos últimos 7 dias. Quem cadastrou o e-mail de outra pessoa pode manter a conta fazendo login, mas o titular real recupera o endereço pela redefinição de senha, que marca o e-mail como verificado e revoga as sessões (BR-016/BR-017).
  - Sem índices novos: a busca de contas usa o índice parcial `users_unverified_created_at_idx`; sessões, tokens e outbox são varridos uma vez por dia, o que é aceitável no volume do MVP. Se o volume crescer, medir e criar índices por data.
- **Testes**:
  - aplicação +2: prazos, ordem e relatório;
  - integração `PrismaIdentityDataRetention` (4): sessões nos três modos de encerramento × recentes × ativa, com refresh tokens por cascata; tokens consumidos ou expirados × recentes × pendente; **RF-15** (abandonada removida com sessões e tokens; login recente, conta nova e conta verificada mantidas); vários lotes;
  - integração `PrismaOutboxRetention` (1): publicados antigos removidos em lotes; recente e pendente antigo mantidos;
  - integração do worker (`maintenance.integration.spec.ts`, 2): dois workers ⇒ um agendamento (`0 0 3 * * *`, UTC) e um job agendado para 03:00 UTC; job executado ⇒ relatório `{ unverifiedUsers: 1, sessions: 0, userTokens: 0, outboxEvents: 1 }` e dados removidos.
- **Mutation testing** (diff confirmado em cada mutação; arquivos restaurados e conferidos com `grep`):
  - sem `NOT EXISTS` de login recente ⇒ 1 falha;
  - sem expiração por inatividade ⇒ 1 falha;
  - só o primeiro lote ⇒ 1 falha;
  - retenção de sessões de 7 dias ⇒ 1 falha;
  - remover só a condição `email_verified_at IS NULL` da subconsulta **sobrevive**, porque a condição externa cobre o caso; remover as duas ⇒ 1 falha;
  - não mutada: `published_at IS NOT NULL` na outbox, redundante porque `NULL < data` já é falso.

  A proteção contra a corrida "verificação durante a limpeza" não tem teste determinístico próprio.

- **Smoke test** (build de produção; banco descartável e índice 1 do Redis, removidos depois; banco local intacto): start ⇒ "Daily data purge scheduled" (`0 0 3 * * *`, UTC) e próximo job em 10/10/2026 03:00 UTC; SIGTERM ⇒ saída 0.
- **Docs**: `docs/architecture/overview.md` (Backend → Retenção).
- **Comandos**: `pnpm verify --skip-nx-cache` ✔ (13 projetos, 363 testes unitários); `pnpm test:integration --skip-nx-cache` ✔ (3 projetos, 76); `pnpm e2e --skip-nx-cache` ✔ (2); `pnpm format:check` ✔.
