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
