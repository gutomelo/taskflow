# 001 — Identity & Access · Design técnico

- **Status**: Aprovado (revisão 3 — decisões do usuário de 2026-10-08 sobre senhas comuns, contas não verificadas e MFA)
- **Requisitos**: [requirements.md](requirements.md)
- **Revisão de arquitetura**: aprovado com ajustes → ajustes incorporados (ver [Histórico de revisões](#histórico-de-revisões))
- **Revisão de segurança**: sem críticos; 1 alto e 6 médios → incorporados

## Solução proposta

Contexto `identity` em quatro camadas. Autenticação por **access token JWT (15 min) + refresh token opaco rotativo**, ambos em cookies HttpOnly; sessões no PostgreSQL (fonte da verdade) com lista de revogação no Redis (cache rápido). E-mails transacionais são **emitidos pelo worker**: o caso de uso grava um evento na `outbox_events` na mesma transação; o worker publica no BullMQ e um caso de uso de envio emite o token de uso único e envia o e-mail via SMTP (Mailpit em desenvolvimento). **Nenhum token em texto puro é persistido.**

## Componentes envolvidos

Tags completas (scope · domain · type). Novos projetos marcados com ★.

| Projeto Nx                               | Tags                                | Conteúdo                                                                                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ★ `libs/backend/shared/kernel`           | backend · shared · domain           | `DomainError` (base com `code`), `Clock`, `IdGenerator` (interface), `EmailAddress` (VO: trim, minúsculas, validação; somente ASCII — endereços internacionalizados fora do MVP).                                                           |
| ★ `libs/backend/shared/application`      | backend · shared · application      | `RequestContext`, `TransactionRunner`, `OutboxWriter`, `IntegrationEvent` (`{ id, type, occurredAt, payload }`), `EmailSender`, `RateLimiter`.                                                                                              |
| ★ `libs/backend/shared/http`             | backend · shared · presentation     | `HttpError`, mapeamento `DomainError`→Problem Details (movido de `apps/api`), `validateBody(zod)`, `requireCsrf`, `createRateLimit(port)`, `createAuthenticate(ports)`, utilitários de cookie.                                              |
| `libs/backend/shared/infrastructure`     | backend · shared · infrastructure   | + `PrismaTransactionRunner` (AsyncLocalStorage), `db()`, `PrismaOutboxWriter`, `OutboxRelay`, fábrica de filas/workers BullMQ, `SmtpEmailSender`, `RedisRateLimiter` (com `insuranceLimiter` em memória), `UuidV7Generator`, `SystemClock`. |
| ★ `libs/backend/identity/domain`         | backend · identity · domain         | `User`, `Session`, `UserToken`; VOs `Password` (BR-011), `PersonName`; erros; repositórios; portas `PasswordHasher`, `SecretTokenGenerator`.                                                                                                |
| ★ `libs/backend/identity/application`    | backend · identity · application    | Casos de uso; portas `AccessTokenIssuer`, `AccessTokenVerifier`, `SessionRevocationList`; payloads dos eventos de fila; consulta `GetUserVerificationStatus` (consumida pela spec 002 via adaptador no composition root).                   |
| ★ `libs/backend/identity/infrastructure` | backend · identity · infrastructure | Repositórios Prisma, `Argon2PasswordHasher` (com limite de concorrência), `JoseAccessTokens`, `RedisSessionRevocationList` (fallback ao banco), templates de e-mail pt-BR, `createIdentityModule()`.                                        |
| ★ `libs/backend/identity/http`           | backend · identity · presentation   | Routers `/api/v1/auth` e `/api/v1/me`, mapeamento de erros de identidade, registro OpenAPI.                                                                                                                                                 |
| `libs/contracts`                         | shared · shared · contracts         | + `auth/*.contract.ts`. **Restrito a contratos HTTP/socket** (ADR 0011).                                                                                                                                                                    |
| `apps/api`                               | backend · app                       | Composition root: instancia portas concretas, monta `authenticate`, `/api/docs` fora de produção. `HttpError`/problem details passam a vir de `shared/http`.                                                                                |
| ★ `apps/worker`                          | backend · app                       | `OutboxRelay`, `Worker` da fila `emails` (tabela tipo de evento → caso de uso), job agendado de limpeza, health em `WORKER_PORT`, graceful shutdown.                                                                                        |
| `apps/web`                               | frontend · app                      | Features `auth`, `account`, `home`; `AuthStore`, interceptor de refresh, guards.                                                                                                                                                            |

Regras de dependência: nenhuma mudança nas `depConstraints`; adiciona-se `ioredis` e `bullmq` aos `bannedExternalImports` de `type:presentation` (middleware não fala com Redis diretamente). `docs/architecture/dependency-rules.md` e `overview.md` passam a listar `shared/{kernel,application,http}`.

### Integração com a spec 002 (BR-013)

`organizations/application` declarará a porta `EmailVerificationChecker.isVerified(userId)`; `apps/api` liga um adaptador que chama `GetUserVerificationStatus` de `identity/application`. Nenhum contexto importa o outro. `emailVerified` **não** vai no JWT (ficaria desatualizado por até 15 min).

### RequestContext

```ts
type RequestContext = Readonly<{
  requestId: string;
  actor: Readonly<{ userId: string; sessionId: string }>;
}>;
```

Imutável e passado explicitamente aos casos de uso. A spec 002 cria seu próprio `TenantContext` em `organizations/application` (não acrescenta `organizationId` aqui).

## Modelo de domínio

- **`User`**: `id`, `email: EmailAddress`, `name: PersonName`, `passwordHash`, `emailVerifiedAt?`, `passwordChangedAt`, `version`. Comportamentos: `register()`, `verifyEmail(clock)`, `changePassword(hash, clock)`.
- **`Session`**: `id`, `userId`, `createdAt`, `lastUsedAt`, `idleExpiresAt`, `absoluteExpiresAt`, `revokedAt?`, `revocationReason?`, `userAgent`, `ipPrefix`, mais **o token atual e o token apresentado** (não o histórico). `rotate(presented, newHash, client, clock)` → `rotated | grace | reuse_detected | expired | revoked` (BR-012/015).
- **`UserToken`**: `purpose`, `tokenHash`, `expiresAt`, `consumedAt?`, `sourceEventId` (único).
- **`Password`** (VO): normaliza NFC, valida a composição de BR-011, **sem truncamento**; descartado após o hash.
- **`CommonPasswordList`** (porta do domínio): verifica a senha contra a lista local das 100 mil senhas mais comuns/vazadas (comparação case-insensitive após NFC). Implementação em `identity/infrastructure` carregando um arquivo embarcado (lista pública de licença permissiva, ex.: SecLists — MIT) em um `Set` na inicialização; usada por `RegisterUser`, `ChangePassword` e `ResetPassword`. Violação: `PASSWORD_POLICY_VIOLATION` com a regra `common_password`.
- **Erros**: `PASSWORD_POLICY_VIOLATION`, `INVALID_CREDENTIALS`, `INVALID_OR_EXPIRED_TOKEN`, `EMAIL_ALREADY_VERIFIED`, `TOKEN_BELONGS_TO_ANOTHER_ACCOUNT`, `SESSION_REVOKED`, `SESSION_EXPIRED`, `REFRESH_IN_PROGRESS`, `CURRENT_PASSWORD_INCORRECT`, `RATE_LIMITED`, `CSRF_VALIDATION_FAILED`, `SERVICE_BUSY`.

### Casos de uso

| Caso de uso                                                   | Onde roda                 | Transação / efeitos                                                                                                                                                                   | Evento (outbox)                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RegisterUser`                                                | API                       | hash Argon2 **sempre antes** da busca; cria `User` ou detecta existente                                                                                                               | `identity.email_verification_requested` ou `identity.account_already_exists_notice` — envio suprimido silenciosamente se o limite por e-mail for excedido (BR-014) |
| `ConfirmEmailVerification`                                    | API                       | **exige sessão do mesmo usuário** (BR-017); consome token, `user.verifyEmail()`                                                                                                       | —                                                                                                                                                                  |
| `ResendEmailVerification`                                     | API                       | —                                                                                                                                                                                     | `identity.email_verification_requested`                                                                                                                            |
| `Login`                                                       | API                       | Argon2 fora da transação (hash fictício se usuário inexistente); cria `Session`; rehash se parâmetros mudaram                                                                         | —                                                                                                                                                                  |
| `RefreshSession`                                              | API                       | `findByRefreshTokenHashForUpdate` (lock pessimista curto) + `session.rotate()`                                                                                                        | —                                                                                                                                                                  |
| `Logout` / `RevokeSession`                                    | API                       | revoga sessão; grava na lista de revogação **antes** do commit                                                                                                                        | —                                                                                                                                                                  |
| `ListSessions`, `GetCurrentUser`, `GetUserVerificationStatus` | API                       | leitura                                                                                                                                                                               | —                                                                                                                                                                  |
| `ChangePassword`                                              | API                       | Argon2 fora da transação; atualiza hash; revoga **outras** sessões; **rotaciona a sessão atual** (novo `sid` e refresh; `sid` antigo na denylist); invalida tokens de reset pendentes | `identity.password_changed_notice`                                                                                                                                 |
| `RequestPasswordReset`                                        | API                       | trabalho constante: **sempre** grava evento com o e-mail normalizado                                                                                                                  | `identity.password_reset_requested`                                                                                                                                |
| `ResetPassword`                                               | API                       | consome token, atualiza hash, marca e-mail verificado, revoga todas as sessões e tokens de reset pendentes                                                                            | `identity.password_changed_notice`                                                                                                                                 |
| `SendEmailVerification`                                       | worker                    | upsert do token por `sourceEventId` (**novo token a cada tentativa**), envia                                                                                                          | —                                                                                                                                                                  |
| `SendPasswordReset`                                           | worker                    | se o e-mail não tem conta, descarta; senão como acima                                                                                                                                 | —                                                                                                                                                                  |
| `SendAccountNotice`                                           | worker                    | envia avisos (duplicatas raras aceitas — pelo menos uma vez)                                                                                                                          | —                                                                                                                                                                  |
| `PurgeExpiredIdentityData`                                    | worker (agendado, diário) | remove sessões expiradas há > 30 d, tokens consumidos/expirados há > 7 d, outbox publicada há > 7 d e **contas não verificadas criadas há > 7 d sem login no período** (RF-15)        | —                                                                                                                                                                  |

## Modelagem de dados

Tabelas **globais** (identidade existe antes de qualquer organização — ADR 0004).

```prisma
model User {
  id                String    @id @db.Uuid
  email             String    @unique
  name              String    @db.VarChar(100)
  passwordHash      String    @map("password_hash")
  emailVerifiedAt   DateTime? @map("email_verified_at") @db.Timestamptz
  passwordChangedAt DateTime  @map("password_changed_at") @db.Timestamptz
  version           Int       @default(1)
  createdAt         DateTime  @map("created_at") @db.Timestamptz
  updatedAt         DateTime  @updatedAt @map("updated_at") @db.Timestamptz
  sessions Session[]
  tokens   UserToken[]
  @@map("users")
}

model Session {
  id                String    @id @db.Uuid
  userId            String    @map("user_id") @db.Uuid
  createdAt         DateTime  @map("created_at") @db.Timestamptz
  lastUsedAt        DateTime  @map("last_used_at") @db.Timestamptz
  idleExpiresAt     DateTime  @map("idle_expires_at") @db.Timestamptz
  absoluteExpiresAt DateTime  @map("absolute_expires_at") @db.Timestamptz
  revokedAt         DateTime? @map("revoked_at") @db.Timestamptz
  revocationReason  String?   @map("revocation_reason") @db.VarChar(32)
  userAgent         String?   @map("user_agent") @db.VarChar(256)
  ipPrefix          String?   @map("ip_prefix") @db.VarChar(64)   // IPv4 /24, IPv6 /64
  user          User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  refreshTokens RefreshToken[]
  @@index([userId, revokedAt])
  @@map("sessions")
}

model RefreshToken {
  id                String    @id @db.Uuid
  sessionId         String    @map("session_id") @db.Uuid
  tokenHash         String    @unique @map("token_hash")
  createdAt         DateTime  @map("created_at") @db.Timestamptz
  rotatedAt         DateTime? @map("rotated_at") @db.Timestamptz
  graceUsedAt       DateTime? @map("grace_used_at") @db.Timestamptz   // BR-012: tolerância usada uma única vez
  session Session @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  @@index([sessionId, createdAt])
  @@map("refresh_tokens")
}

model UserToken {
  id            String           @id @db.Uuid
  userId        String           @map("user_id") @db.Uuid
  purpose       UserTokenPurpose
  tokenHash     String           @unique @map("token_hash")
  sourceEventId String           @unique @map("source_event_id") @db.Uuid
  expiresAt     DateTime         @map("expires_at") @db.Timestamptz
  consumedAt    DateTime?        @map("consumed_at") @db.Timestamptz
  createdAt     DateTime         @map("created_at") @db.Timestamptz
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, purpose, consumedAt])
  @@map("user_tokens")
}

enum UserTokenPurpose {
  email_verification
  password_reset
  @@map("user_token_purpose")
}

model OutboxEvent {
  id          String    @id @db.Uuid
  type        String    @db.VarChar(100)
  payload     Json
  occurredAt  DateTime  @map("occurred_at") @db.Timestamptz
  publishedAt DateTime? @map("published_at") @db.Timestamptz
  @@map("outbox_events")
}
```

- Índice parcial criado por SQL na migration: `CREATE INDEX outbox_events_unpublished_idx ON outbox_events (occurred_at) WHERE published_at IS NULL`.
- Payload da outbox: apenas `userId`, exceto `password_reset_requested` (`{ email }` normalizado, necessário para o trabalho constante). Removido pela limpeza após 7 dias.
- Restrições manuais na migration `add_identity_tables` (T9), além do schema Prisma: `CHECK` de e-mail normalizado; `CHECK` inatividade ≤ absoluto; `CHECK` revogação consistente (data e motivo juntos); **índice único parcial "um refresh token atual por sessão"** (BR-012 no banco); `CHECK` tolerância só após rotação; `CHECK` validade de token posterior à criação; índice parcial de usuários não verificados por `created_at` (RF-15). Motivos de revogação e finalidades de token são enums do PostgreSQL. Hashes de token em `CHAR(64)` (SHA-256 hex).
- Migrations **aditivas** (`add_outbox_events` na T5, `add_identity_tables` na T9); roll-forward.

## Contratos

### Endpoints

| Método | URI                                       | Auth                  | CSRF | Rate limit                                                           | Request                            | Sucesso                                            | Erros                                                                                                |
| ------ | ----------------------------------------- | --------------------- | ---- | -------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/auth/csrf`                       | —                     | —    | —                                                                    | —                                  | 204 + cookie `__Host-tf_csrf`                      | —                                                                                                    |
| POST   | `/api/v1/auth/register`                   | —                     | ✔    | 5/h IP; envio: 1/10 min e 5/dia por e-mail (suprime silenciosamente) | `{ name, email, password }`        | 202                                                | 400, 422, 429                                                                                        |
| POST   | `/api/v1/auth/email-verification/confirm` | ✔                     | ✔    | 20/h usuário                                                         | `{ token }`                        | 204                                                | 400 `INVALID_OR_EXPIRED_TOKEN`, 403 `TOKEN_BELONGS_TO_ANOTHER_ACCOUNT`, 409 `EMAIL_ALREADY_VERIFIED` |
| POST   | `/api/v1/auth/email-verification/resend`  | ✔                     | ✔    | 3/h usuário                                                          | —                                  | 202                                                | 409, 429                                                                                             |
| POST   | `/api/v1/auth/login`                      | —                     | ✔    | 30/15 min IP; por conta: atraso progressivo após falhas (BR-018)     | `{ email, password }`              | 200 `CurrentUser` + cookies                        | 401, 429, 503 `SERVICE_BUSY`                                                                         |
| POST   | `/api/v1/auth/refresh`                    | cookie refresh        | ✔    | 60/min sessão                                                        | —                                  | 204 + cookies                                      | 401 `SESSION_REVOKED`/`SESSION_EXPIRED`, 409 `REFRESH_IN_PROGRESS`                                   |
| POST   | `/api/v1/auth/logout`                     | access **ou** refresh | ✔    | —                                                                    | —                                  | 204 + limpa cookies + `Clear-Site-Data: "cookies"` | —                                                                                                    |
| POST   | `/api/v1/auth/password/forgot`            | —                     | ✔    | 3/h e-mail; 10/h IP                                                  | `{ email }`                        | 202                                                | 429                                                                                                  |
| POST   | `/api/v1/auth/password/reset`             | —                     | ✔    | 10/h IP                                                              | `{ token, newPassword }`           | 204                                                | 400, 422                                                                                             |
| GET    | `/api/v1/me`                              | ✔                     | —    | —                                                                    | —                                  | 200 `CurrentUser`                                  | 401                                                                                                  |
| POST   | `/api/v1/me/password`                     | ✔                     | ✔    | 5/h usuário                                                          | `{ currentPassword, newPassword }` | 204 + novos cookies                                | 403 `CURRENT_PASSWORD_INCORRECT`, 422                                                                |
| GET    | `/api/v1/me/sessions`                     | ✔                     | —    | —                                                                    | —                                  | 200 `{ items: SessionSummary[] }`                  | 401                                                                                                  |
| DELETE | `/api/v1/me/sessions/{sessionId}`         | ✔                     | ✔    | —                                                                    | —                                  | 204                                                | 404                                                                                                  |

`CurrentUser = { id, name, email, emailVerified }` · `SessionSummary = { id, createdAt, lastUsedAt, device: { browser, os }, isCurrent }` (dados estruturados; o frontend compõe o texto — i18n) · bodies `.strict()` · todos os limites por IP usam IPv4 completo / IPv6 /64.

### Eventos de fila (`emails`)

Payloads tipados em `identity/application` (não em `libs/contracts`, que é restrito a HTTP/socket — ADR 0011).

| Tipo                                     | Payload      | Caso de uso no worker                                                                         |
| ---------------------------------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `identity.email_verification_requested`  | `{ userId }` | `SendEmailVerification` → link `APP_URL/verify-email#token=…` (24 h)                          |
| `identity.account_already_exists_notice` | `{ userId }` | `SendAccountNotice`                                                                           |
| `identity.password_reset_requested`      | `{ email }`  | `SendPasswordReset` → `APP_URL/reset-password#token=…` (30 min); descarta se não houver conta |
| `identity.password_changed_notice`       | `{ userId }` | `SendAccountNotice`                                                                           |

- Tokens no **fragmento** da URL: não chegam ao servidor, a logs de proxy nem ao `Referer`. O SPA lê o fragmento, remove-o com `history.replaceState` e só envia o token após **clique explícito** do usuário (nunca POST automático no carregamento).
- E-mails não incluem conteúdo controlado pelo usuário quando a conta não está verificada (saudação genérica); todo conteúdo dinâmico é escapado.

## Segurança

```mermaid
sequenceDiagram
    autonumber
    participant B as Navegador
    participant MW as authenticate (shared/http)
    participant RL as SessionRevocationList
    participant UC as Use case
    B->>MW: cookie __Host-tf_at
    MW->>MW: jose.jwtVerify(algorithms=[HS256], kid ∈ mapa fixo, iss, aud, exp)
    MW->>RL: isRevoked(sid)
    Note over RL: Redis; se indisponível → consulta sessions.revoked_at no PostgreSQL
    alt inválido ou revogado
        MW-->>B: 401
    else ok
        MW->>UC: RequestContext { requestId, actor { userId, sessionId } }
    end
```

### Tokens e cookies

- **Access**: JWT HS256, segredo ≥ 256 bits com `kid`; `algorithms: ['HS256']` fixo; `kid` desconhecido rejeitado; `clockTolerance` 5 s. Cookie `__Host-tf_at` (`Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`, 15 min).
- **Refresh**: 32 bytes aleatórios; cookie `__Secure-tf_rt` (`Path=/api/v1/auth`, `HttpOnly`, `Secure`, `SameSite=Strict`). Path restrito reduz exposição; como `__Secure-` permite plantio a partir de subdomínios irmãos, **nenhum subdomínio do domínio de produção pode ser controlado por terceiros** (registrado no ADR 0005).
- **Denylist**: `revoked-session:{sid}` com TTL 20 min (≥ vida do access + tolerância), gravada **antes do commit** (idempotente; falso positivo em rollback é inofensivo). PostgreSQL é a fonte da verdade e o fallback.
- **Redis**: `maxmemory-policy noeviction` obrigatório (também exigido pelo BullMQ) — configurado no Compose e documentado para produção.

### BR-012 — rotação com tolerância estrita

Ao apresentar um refresh já rotacionado:

- tolerância **somente** se for o predecessor imediato do token atual, rotacionado há ≤ **5 s**, `graceUsedAt` vazio e mesmo `ipPrefix` + `userAgent` → marca `graceUsedAt`, responde 409 `REFRESH_IN_PROGRESS`, registra `auth.refresh_grace_hit`;
- qualquer outro caso (segunda apresentação, token mais antigo, cliente diferente, fora da janela) → revoga a sessão (`reuse_detected`), 401, registra `auth.refresh_reuse_detected`.

Consequência: com três ou mais renovações simultâneas do mesmo token, a terceira é tratada como reuso e revoga a sessão — por isso o frontend **deve** serializar renovações entre abas (Web Locks, T24); coberto por teste de integração.

No 409 o cliente **não repete o refresh**: aguarda o lock entre abas (Web Locks) e repete a requisição original, que já usa o cookie novo.

### CSRF

1. Métodos não seguros sem `Origin` **e** sem `Referer` → 403; `Origin`/`Referer` ≠ `APP_ORIGIN` → 403; `Sec-Fetch-Site` presente e diferente de `same-origin` → 403.
2. Double-submit assinado: cookie `__Host-tf_csrf` (não HttpOnly, `SameSite=Strict`) com `valor.HMAC(valor, sid | "anon")`; header `X-CSRF-Token` igual ao cookie; comparação em tempo constante; novo token no login, logout e rotação de sessão.

### Abuso (BR-018)

- `rate-limiter-flexible` com Redis e `insuranceLimiter` em memória (Redis fora não desliga os limites nem derruba a API).
- **Por conta (login)**: após 5 falhas consecutivas, atraso exigido dobra a cada falha (1 s → 15 min, teto), zerando no sucesso; durante o atraso, 429 com `Retry-After`. Não há bloqueio permanente (evita DoS de bloqueio da vítima).
- **Argon2**: semáforo de concorrência (padrão 4 hashes simultâneos por processo, 19 MiB cada); fila de espera curta; excedente → 503 `SERVICE_BUSY` com `Retry-After`.
- `TRUST_PROXY` deve ser exatamente o número de proxies confiáveis (valor maior permite forjar `X-Forwarded-For`) — validado e documentado.

### Não enumeração (BR-014)

- Cadastro: Argon2 sempre executado antes da busca; mesma resposta 202; supressão silenciosa de e-mails por limite.
- Esqueci a senha: trabalho constante (sempre grava evento); worker descarta quando não há conta.
- Login: verificação contra hash fictício quando o usuário não existe.
- Limites por e-mail aplicados **antes** de consultar a conta.

### Eventos de segurança

Porta `SecurityEventRecorder` (`identity/application`) registra `auth.refresh_grace_hit`, `auth.refresh_reuse_detected` e `auth.session_revoked` com identificadores apenas; implementada com o logger estruturado no composition root (T16).

### Logs e privacidade

- Serializer do `pino-http` restrito a `method`, `url` (sem query string), `requestId` e `user-agent`; IP registrado apenas como prefixo; `x-csrf-token`, cookies e `authorization` nunca registrados.
- Identificação de e-mail em logs por **HMAC-SHA-256 com chave** (`LOG_PSEUDONYMIZATION_KEY`), não hash simples.
- Eventos: `auth.login_succeeded`, `auth.login_failed`, `auth.refresh_grace_hit`, `auth.refresh_reuse_detected`, `auth.session_revoked`, `auth.password_changed`, `auth.password_reset_completed`, `auth.email_verified`.
- Retenção: `ipPrefix`/`userAgent` existem enquanto a sessão existir (+30 d até a limpeza); logs de aplicação 30 d (política a confirmar para produção — LGPD).

### Outros

- `Cache-Control: no-store` em `/auth` e `/me`. `Referrer-Policy: no-referrer` e CSP sem origens de terceiros nas páginas do SPA (Nginx e dev server); a fonte Inter passa a ser auto-hospedada para permitir CSP restrita.
- `returnUrl` aceito somente se começar com `/` e não com `//` ou `/\`.

## Concorrência e consistência

- **Transações**: porta `TransactionRunner.run(work)`; `PrismaTransactionRunner` guarda o `tx` em `AsyncLocalStorage` e os repositórios obtêm o client por `db()` (Prisma não vaza para `application`). Argon2 e chamadas externas ficam **fora** das transações.
- **Refresh**: `SessionRepository.findByRefreshTokenHashForUpdate(hash)` localiza a sessão, executa `SELECT … FOR UPDATE` e relê os tokens; falha se chamado fora de transação. Lock pessimista curto é usado aqui em vez do optimistic locking do ADR 0006 porque a contenção é alta, curta e o resultado depende do estado lido (exceção prevista no próprio ADR 0006).
- **Cadastro concorrente**: unique em `users.email`; violação tratada como conta existente.
- **Confirmação de e-mail (BR-017)**: `UserTokenRepository.findOwner` identifica o dono sem consumir (token de outra conta ⇒ 403 e o token continua válido para o titular); o consumo é condicionado ao dono no mesmo `UPDATE` (`consume(..., { userId })`), sem janela entre verificar e consumir. E-mail já verificado ⇒ 409 antes de tocar no token.
- **Consumo de token**: `UPDATE … WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()`; `count = 0` → inválido.
- **Outbox relay** (worker, a cada 1 s): transação curta com `SELECT … WHERE published_at IS NULL ORDER BY occurred_at LIMIT 50 FOR UPDATE SKIP LOCKED` → `queue.addBulk` com `jobId = event.id` → `published_at = now()`. A transação fica aberta durante o `addBulk` (lote pequeno; `statement_timeout` de 5 s). BullMQ com `removeOnComplete: { age: 86400 }` e `removeOnFail: { age: 604800 }` para que a deduplicação por `jobId` cubra republicações.
- **Envio**: a cada tentativa, `INSERT … ON CONFLICT (source_event_id) DO UPDATE SET token_hash, expires_at` com token novo e só então envia — vale o link da última tentativa. 5 tentativas, backoff exponencial (5 s base). Falha permanente: log `error`, job em `failed`.

## Frontend

- Rotas (lazy): `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, `/` (home autenticada), `/account/security`, `/status`.
- `/verify-email`: lê o token do fragmento e limpa a URL; se não autenticado, pede login preservando o token em memória; depois mostra botão "Confirmar e-mail" (clique explícito).
- `AuthStore` (Signals) com bootstrap via `GET /me` em `provideAppInitializer`.
- Interceptor: 401 → refresh single-flight coordenado entre abas (`navigator.locks`) → repete a requisição original uma vez; 409 `REFRESH_IN_PROGRESS` → aguarda o lock e repete a requisição original; falha → `/login?returnUrl=…`.
- `withXsrfConfiguration({ cookieName: '__Host-tf_csrf', headerName: 'X-CSRF-Token' })`; token obtido de `GET /auth/csrf` no bootstrap.
- Guards `authGuard`/`guestGuard`; formulários tipados; requisitos de senha em tempo real com `aria-live`; erros por `code`.
- Shell autenticado com menu do usuário e banner de verificação de e-mail.

## Observabilidade

Eventos de segurança acima; `eventId` como `correlationId` no worker; readiness do worker (PostgreSQL + Redis). Métricas de fila e atraso da outbox na Fase 4.

## Configuração nova

| Variável                                  | Uso                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `APP_ORIGIN`, `APP_URL`                   | CSRF e links de e-mail                                                               |
| `AUTH_ACCESS_TOKEN_KEYS`                  | mapa `kid → segredo` (JSON), cada segredo ≥ 32 bytes; `AUTH_ACCESS_TOKEN_ACTIVE_KID` |
| `CSRF_SECRET`, `LOG_PSEUDONYMIZATION_KEY` | HMACs (≥ 32 bytes)                                                                   |
| `COOKIE_SECURE`                           | `true` por padrão                                                                    |
| `PASSWORD_HASH_CONCURRENCY`               | semáforo do Argon2 (padrão 4)                                                        |
| `SMTP_URL`, `EMAIL_FROM`                  | Mailpit local: `smtp://localhost:51025`                                              |
| `WORKER_PORT`                             | health do worker (3334)                                                              |

## Decisões arquiteturais

| Decisão                    | Escolha e motivo                                                                                                                                             | ADR  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| Tokens e cookies           | JWT HS256 15 min com `kid` + refresh opaco rotativo; `__Host-` para access, `__Secure-` com path restrito para refresh; denylist Redis com fallback ao banco | 0005 |
| Worker/outbox na Fase 1    | Decisão do usuário; e-mails críticos não podem se perder; token emitido no worker                                                                            | 0011 |
| Middlewares compartilhados | `libs/backend/shared/http` (reuso verificado pelo lint) em vez de montá-los só em `apps/api`                                                                 | —    |
| Transações                 | `AsyncLocalStorage` restrito à infraestrutura em vez de passar unit of work por parâmetro                                                                    | —    |
| Rate limit                 | `rate-limiter-flexible` (limites compostos, `insuranceLimiter`)                                                                                              | —    |
| OpenAPI                    | `zod-openapi` a partir de `libs/contracts`; Swagger UI fora de produção                                                                                      | —    |

## Riscos

| Risco                                                        | Prob. | Impacto | Mitigação                                                                                |
| ------------------------------------------------------------ | ----- | ------- | ---------------------------------------------------------------------------------------- |
| Composição clássica (BR-011) diverge do NIST 800-63B         | Média | Baixo   | Lista local de senhas comuns/vazadas (decisão do usuário) + atraso progressivo por conta |
| Ausência de MFA (requisito ASVS L2)                          | —     | Médio   | **Desvio consciente aprovado pelo usuário**; TOTP em spec própria pós-MVP                |
| Sessão de 30 dias acima da recomendação L2 de reautenticação | —     | Baixo   | Operações sensíveis exigem senha atual (troca de senha)                                  |
| Falso positivo de reuso                                      | Baixa | Médio   | Tolerância estrita + Web Locks + teste de corrida                                        |
| Worker antecipado                                            | Média | Médio   | Escopo mínimo; integração com Redis real                                                 |
| Redis indisponível                                           | Média | Médio   | Fallback ao banco para revogação; `insuranceLimiter`; readiness                          |

## Histórico de revisões

| Revisão | Origem      | Mudanças principais                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Autor       | Versão inicial                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 2       | Arquitetura | `shared/http`; BR-013 via porta + adaptador; casos de uso de envio na `application`; upsert de token por tentativa; `AsyncLocalStorage`; lock explícito no repositório; tags completas; `RequestContext` com `actor`; denylist antes do commit; `removeOnComplete` com idade; índice parcial; payloads de fila fora de `libs/contracts`                                                                                                                                                                                                                                                           |
| 2       | Segurança   | Confirmação de e-mail exige sessão do mesmo usuário + clique (A1); tolerância de refresh estrita e de uso único (M1); token no fragmento + `Referrer-Policy` + CSP (M2); `noeviction` e fallback ao banco (M3); atraso progressivo por conta, IPv6 /64, semáforo Argon2 (M4); supressão de envio por e-mail e e-mails sem conteúdo do usuário (M5); rotação da sessão atual na troca de senha (M6); trabalho constante (B1); CSRF assinado e `__Host-` (B2); JWT estrito (B3); serializer de logs e HMAC (B4); logout por refresh e `Clear-Site-Data` (B5); `returnUrl` (B6); NFC sem truncamento |
| 3       | Usuário     | Lista local de senhas comuns (BR-011); remoção de contas não verificadas após 7 dias (RF-15); MFA registrado como desvio; spec aprovada                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
