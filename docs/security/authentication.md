# Autenticação

Status: **Implementado e testado** (spec [001-authentication](../../specs/001-authentication/requirements.md)). Decisões em [ADR 0005](../architecture/adr/0005-authentication-tokens-and-cookies.md) (tokens e cookies) e [ADR 0011](../architecture/adr/0011-early-worker-and-outbox-for-email.md) (e-mails pelo worker). Detalhes e justificativas no [design](../../specs/001-authentication/design.md); evidências de teste em [tasks.md](../../specs/001-authentication/tasks.md). Itens marcados _rev. 4_ vêm das correções da T29 e aguardam a aprovação da revisão 4 do design.

Regras de negócio: BR-011…BR-018 em [business-rules.md](../product/business-rules.md#br-011--política-de-senha).

## Visão geral

```mermaid
sequenceDiagram
    autonumber
    participant SPA as SPA (Angular)
    participant API as API (Express)
    participant DB as PostgreSQL
    participant R as Redis

    SPA->>API: POST /api/v1/auth/login (Origin + X-CSRF-Token)
    API->>R: reserva da conta + atraso BR-018
    API->>API: Argon2id (sempre; hash fictício se não há conta)
    API->>DB: cria sessão + refresh token (hash)
    API-->>SPA: 200 CurrentUser + cookies tf_at, tf_rt e novo tf_csrf
    SPA->>API: GET /api/v1/me (cookie tf_at)
    API->>R: sessão revogada? (fallback: PostgreSQL)
    API-->>SPA: 200 / 401 (JWT expirado)
    SPA->>API: POST /api/v1/auth/refresh (voo único, Web Lock entre abas)
    API->>DB: SELECT … FOR UPDATE, rotaciona o refresh token
    API-->>SPA: 204 + cookies novos
```

## Credenciais

| Item           | Implementação                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hash de senha  | Argon2id, parâmetros mínimos OWASP (`m=19456 KiB`, `t=2`, `p=1`); rehash transparente no login se os parâmetros mudarem. Concorrência limitada por processo (`PASSWORD_HASH_CONCURRENCY`); fila cheia ⇒ 503 `SERVICE_BUSY`.                             |
| Política       | BR-011 no domínio (`Password`): 8–128 caracteres contados em code points após NFC, maiúscula, minúscula, dígito, símbolo, diferente do e-mail, fora da lista local de 97.745 senhas comuns (NCSC/SecLists). O frontend espelha as regras para feedback. |
| Não enumeração | Login sempre executa Argon2 (hash fictício sem conta; diferença de tempo médio < 50 ms medida no teste do CA-04); cadastro calcula o hash antes de consultar; cadastro, recuperação e reenvio respondem igual (BR-014).                                 |

## Tokens e cookies

| Cookie           | Conteúdo                                                                               | Atributos                                                                            | Validade                                                                               |
| ---------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `__Host-tf_at`   | JWT HS256 (`kid` de um mapa fixo, `iss`, `aud`, `sub`, `sid`, `exp`), algoritmo fixado | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`                                       | JWT: 15 min. Cookie: o mesmo da sessão, para refresh/logout acharem o `sid` (_rev. 4_) |
| `__Secure-tf_rt` | 256 bits aleatórios; no banco só o SHA-256                                             | `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth`                         | Inatividade da sessão (7 dias)                                                         |
| `__Host-tf_csrf` | `valor.HMAC(valor, sid ou "anon")`                                                     | **sem** `HttpOnly` (o Angular ecoa no header), `Secure`, `SameSite=Strict`, `Path=/` | Sessão do navegador                                                                    |

Nenhum token é guardado em `localStorage`/`sessionStorage`; o JavaScript da página não lê os cookies de sessão (verificado no E2E). `__Secure-` permite plantio a partir de subdomínios irmãos: **nenhum subdomínio do domínio de produção pode ser controlado por terceiros** (ADR 0005).

## Sessões

- **Duração** (BR-015): 7 dias de inatividade (deslizante) e 30 dias absolutos.
- **Rotação** (BR-012): cada refresh emite um token novo sob `SELECT … FOR UPDATE`. Reapresentar um token rotacionado revoga a sessão e registra `auth.refresh_reuse_detected`, exceto uma única vez para o predecessor imediato, em até 5 s e do mesmo cliente (prefixo de IP e user agent), que recebe 409 `REFRESH_IN_PROGRESS`.
- **Revogação imediata**: `revoked-session:{sid}` no Redis (TTL 20 min), gravada antes do commit; com o Redis fora, a autenticação consulta o PostgreSQL. Logout e revogação pela lista travam a sessão antes de ler (_rev. 4_), sem corrida com um refresh concorrente.
- **Troca e redefinição de senha** (BR-016): revogação atômica das outras sessões (troca) ou de todas (redefinição); tokens de recuperação pendentes invalidados; a troca cria uma sessão nova para o navegador atual.
- **Listagem**: só sessões ativas do próprio usuário, com IP reduzido ao prefixo (IPv4 /24, IPv6 /64) e user agent truncado; revogar sessão de outro usuário responde 404.

## CSRF

1. **Origem**: `Sec-Fetch-Site` (quando presente) igual a `same-origin`; `Origin`/`Referer` igual a `APP_ORIGIN` (https exigido em produção, _rev. 4_).
2. **Double-submit assinado**: header `X-CSRF-Token` igual ao cookie, com HMAC ligado à sessão (`sid`) ou a `anon`, comparação em tempo constante.

O token é reemitido no login, na troca de senha e, quando o vínculo atual não é o da sessão, no refresh. `GET /auth/csrf` usa o mesmo vínculo de refresh/logout, aceitando o access token expirado (_rev. 4_). O SPA relê o token ao repetir uma requisição e, num 403 `CSRF_VALIDATION_FAILED`, pede outro e repete uma vez. O logout manda `Clear-Site-Data: "cookies"`, e o SPA então pede um novo token para o próximo login.

## E-mails: verificação e recuperação

- Emitidos pelo **worker** a partir da outbox (ADR 0011); o token de uso único (256 bits, só o hash no banco) nasce no worker, **um por evento** e regravado a cada tentativa, de modo que vale o link da última tentativa. Reentrega de um link já usado não é enviada.
- **Token no fragmento** da URL (`/verify-email#token=…`, `/reset-password#token=…`): não chega a servidores, logs de proxy nem `Referer` (`Referrer-Policy: no-referrer`). O SPA lê o token uma vez, remove o fragmento e o mantém só em memória.
- **Verificação** (BR-017): exige sessão da própria conta **e** clique explícito; token de outra conta ⇒ 403 sem consumir. Validade 24 h.
- **Recuperação**: validade 30 min; redefinir verifica o e-mail e revoga todas as sessões; pedido anterior à última troca de senha é descartado (_rev. 4_).
- E-mails de conta não verificada não usam o nome informado no cadastro; HTML sempre escapado. Em produção o SMTP exige TLS (_rev. 4_).

## Limites e proteção contra abuso

| Alvo                          | Limite                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Login                         | 30 / 15 min por IP; por conta, atraso progressivo após 5 falhas (BR-018), com uma tentativa por vez (_rev. 4_)                                  |
| Cadastro                      | 5 / h por IP                                                                                                                                    |
| Refresh / logout              | 120 / min e 60 / min por IP (_rev. 4_)                                                                                                          |
| Esqueci a senha               | 3 / h por e-mail e 10 / h por IP                                                                                                                |
| Redefinir senha               | 10 / h por IP                                                                                                                                   |
| Confirmar / reenviar e-mail   | 20 / h e 3 / h por usuário                                                                                                                      |
| Troca de senha                | 5 / h por usuário                                                                                                                               |
| E-mails enviados (silencioso) | Verificação: 1 / 10 min e 5 / dia por endereço. Recuperação: 1 / 10 min e 5 / dia por endereço e rede, teto de 20 / dia por endereço (_rev. 4_) |

Respostas 429 trazem `Retry-After`. Os limites vivem no Redis (`noeviction`); se ele cair, um limitador em memória por processo assume.

## Frontend

- `AuthStore` (Signals) resolvido antes da primeira navegação (`/auth/csrf` → `/me`, timeout de 5 s; falha ⇒ anônimo).
- Interceptor: 401 ⇒ refresh em voo único na aba e serializado entre abas (Web Lock `taskflow:session-refresh`), repetindo a requisição original uma vez; refresh recusado ⇒ anônimo e `/login?returnUrl=…`; falha de rede não encerra a sessão.
- `returnUrl` aceita só caminhos internos e descarta o fragmento; guards são UX, o controle de acesso é da API.
- Documento com CSP restrita por nonce (sem origens de terceiros), `frame-ancestors 'none'`, `no-referrer`.

## Logs e privacidade

- Redação de `authorization`, `cookie`, `set-cookie`, senhas e tokens; serializers de requisição sem headers nem query string.
- E-mail em logs só como HMAC com chave (`LOG_PSEUDONYMIZATION_KEY`).
- Eventos de segurança: `auth.login_succeeded`/`auth.login_failed` (logs HTTP), `auth.refresh_grace_hit`, `auth.refresh_reuse_detected`, `auth.session_revoked`, `auth.password_changed`, `auth.password_reset_completed` — só com identificadores.
- Retenção diária: contas não verificadas sem uso de sessão há mais de 7 dias (RF-15, medido por `last_used_at` — _rev. 4_), sessões encerradas há mais de 30 dias, tokens e eventos publicados da outbox há mais de 7 dias.

## Riscos aceitos e pendências

| Item                                                                                                   | Situação                                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| MFA/TOTP e passkeys (exigidos pelo OWASP ASVS L2)                                                      | Desvio consciente; spec própria pós-MVP                                              |
| Atacante com muitas redes distintas esgota o teto diário de e-mails de recuperação (20) de um endereço | Risco residual aceito; revisar com métricas de supressão                             |
| HS256 com segredo compartilhado                                                                        | Adequado a um único emissor/verificador (a API); revisar se surgirem outros serviços |
| GitHub Actions fixadas por tag, não por SHA                                                            | Endurecimento futuro da pipeline                                                     |
