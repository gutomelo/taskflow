# 0005 — Autenticação com access token JWT curto e refresh token opaco rotativo em cookies

- **Status**: Aceito (2026-10-08, com a aprovação da [spec 001](../../../specs/001-authentication/design.md))
- **Data**: 2026-10-08
- **Relacionados**: [authentication](../../security/authentication.md), [ADR 0006](0006-optimistic-locking.md), [ADR 0011](0011-early-worker-and-outbox-for-email.md)

## Contexto

O SPA Angular precisa de sessões seguras, revogáveis e resistentes a XSS e CSRF. O brief exige JWT com access + refresh rotativo, detecção de reuso, revogação e proíbe tokens em `localStorage`. Frontend e API são servidos na mesma origem (proxy).

## Alternativas consideradas

### A — JWT de longa duração em `localStorage` + header `Authorization`

- Contras: exposto a XSS; sem revogação. Rejeitada.

### B — Sessão server-side clássica (cookie de sessão + store)

- Prós: revogação trivial.
- Contras: não atende ao requisito explícito de JWT; toda requisição consulta o store.

### C — Access JWT curto + refresh opaco rotativo, ambos em cookies HttpOnly

- Prós: access verificado sem I/O de banco; refresh revogável com detecção de reuso; nada acessível a JavaScript.
- Contras: exige CSRF, denylist para revogação imediata e cuidado com cookies.

## Decisão

Adotamos **C**:

- **Access**: JWT HS256 de 15 min, chaves por `kid` (mapa fixo; rotação aceitando chave anterior), `algorithms` fixado, claims `sub`, `sid`, `iss`, `aud`, `iat`, `exp`. Cookie `__Host-tf_at` (`Path=/`, `HttpOnly`, `Secure`, `SameSite=Lax`).
- **Refresh**: 256 bits aleatórios, persistido só como SHA-256; cookie `__Secure-tf_rt` com `Path=/api/v1/auth` e `SameSite=Strict` (não trafega em toda requisição). Como `__Secure-` permite plantio a partir de subdomínios irmãos, **nenhum subdomínio do domínio de produção pode ser controlado por terceiros**.
- **Rotação** a cada uso; reapresentação de token rotacionado revoga a sessão, com tolerância única de 5 s para o predecessor imediato do mesmo cliente (BR-012). Rotação usa lock pessimista curto na sessão — exceção ao ADR 0006 justificada pela contenção alta e curta e pela decisão depender do estado lido.
- **Sessão**: 7 dias deslizante, 30 dias absoluto (BR-015).
- **Revogação imediata**: denylist `revoked-session:{sid}` no Redis (TTL 20 min, gravada antes do commit), com fallback ao PostgreSQL se o Redis estiver indisponível; Redis em `noeviction`.
- **CSRF**: verificação de `Origin`/`Referer`/`Sec-Fetch-Site` + double-submit assinado (`__Host-tf_csrf`, HMAC ligado à sessão).
- **Senhas**: Argon2id (m=19 MiB, t=2, p=1) com limite de concorrência por processo.
- Estado de verificação de e-mail e organização ativa **não** vão no token (valores mutáveis são consultados por requisição).

## Consequências

- **Positivas**: resistência a XSS e CSRF; revogação em ≤ 1 s; detecção de roubo de refresh.
- **Negativas**: implantação exige mesma origem; Redis entra no caminho de autenticação (com fallback); mais estado no banco.
- **Como verificar**: testes de integração de rotação, reuso, tolerância, revogação, expiração, CSRF e atributos de cookie (spec 001, CA-04…CA-11).
