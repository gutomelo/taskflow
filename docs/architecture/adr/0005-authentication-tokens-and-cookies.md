# 0005 — Autenticação com access token JWT curto e refresh token opaco rotativo em cookies

- **Status**: Proposto — será confirmado ou ajustado na spec 001
- **Data**: 2026-10-08
- **Relacionados**: [authentication](../../security/authentication.md)

## Contexto

O SPA Angular precisa de sessões seguras, revogáveis e que resistam a XSS e CSRF. O brief exige JWT com access + refresh rotativo, detecção de reuso, revogação e proibição de tokens em `localStorage`.

## Alternativas consideradas

### A — JWT de longa duração em `localStorage` + header `Authorization`

- Contras: exposto a XSS; sem revogação. Rejeitada.

### B — Sessão server-side clássica (cookie de sessão + store em Redis)

- Prós: revogação trivial, simples.
- Contras: não atende ao requisito explícito de JWT; toda request consulta o store.

### C — Access JWT curto + refresh opaco rotativo, ambos em cookies HttpOnly

- Prós: access verificado sem I/O; refresh revogável com detecção de reuso; nada acessível a JavaScript.
- Contras: exige proteção CSRF e cuidado com domínio/SameSite.

## Decisão (proposta)

- **Access token**: JWT assinado (EdDSA ou HS256 — decidir na spec 001), validade 10–15 min, claims mínimas (`sub`, `sid`, `iat`, `exp`); cookie `__Host-tf_at`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- **Refresh token**: valor aleatório de 256 bits, armazenado **apenas como hash** (SHA-256) com `familyId`, `expiresAt`, `revokedAt`, `replacedBy`; cookie com path restrito ao endpoint de refresh. Como o prefixo `__Host-` exige `Path=/`, a spec 001 escolhe entre `__Host-tf_rt` (`Path=/`) e `__Secure-tf_rt` (`Path=/api/v1/auth`), documentando o trade-off.
- **Rotação**: cada refresh invalida o anterior e emite um novo na mesma família. Reuso de token já rotacionado → revoga a família inteira e registra evento de segurança.
- **CSRF**: mesma origem via reverse proxy + `SameSite=Lax` + verificação de `Origin`/`Sec-Fetch-Site` em métodos não seguros + token double-submit para mutações.
- **Organização ativa** não fica no token como fonte de verdade; é validada por request contra memberships.
- Senhas com Argon2id (parâmetros OWASP), rate limit em endpoints de autenticação.

## Consequências

- **Positivas**: resistência a XSS (tokens inacessíveis ao JS), revogação e detecção de roubo de refresh.
- **Negativas**: implantação exige mesma origem (ou subdomínios com cuidado de cookies); mais estado no banco.
- **Como verificar**: testes de integração de rotação, reuso, revogação, expiração e CSRF (spec 001).
