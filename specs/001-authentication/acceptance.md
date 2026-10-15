# 001 — Identity & Access · Aceitação

Arquivos de teste indicados são os planejados; serão confirmados na implementação.

## Cenários

### CA-01 — Cadastro envia verificação

```gherkin
Dado um visitante sem conta
Quando cadastra nome, "Ana@Exemplo.com " e uma senha válida
Então a API responde 202
E existe um usuário com e-mail "ana@exemplo.com" não verificado
E um evento identity.email_verification_requested foi gravado na outbox na mesma transação
E, com o worker rodando, o Mailpit recebe um e-mail com link de verificação
```

Testes: `register-user.use-case.spec.ts`, `auth.router.spec.ts`, `email-delivery.integration.spec.ts`, E2E.

### CA-02 — Cadastro com e-mail existente (BR-014)

```gherkin
Dado que "ana@exemplo.com" já possui conta
Quando alguém cadastra "ana@exemplo.com"
Então a API responde 202 com o mesmo corpo do CA-01
E nenhuma conta é criada ou alterada
E o titular recebe um e-mail informativo, não um link de verificação
```

### CA-03 — Verificação de e-mail

```gherkin
Dado um link de verificação válido e o usuário autenticado na mesma conta
Quando abre o link e clica em "Confirmar e-mail"
Então o e-mail fica verificado e o token não pode ser reutilizado
E abrir o link sem sessão leva ao login, sem confirmar nada automaticamente
E usar o token autenticado em outra conta responde 403 TOKEN_BELONGS_TO_ANOTHER_ACCOUNT
E um segundo uso responde que o e-mail já está confirmado
E um token expirado (> 24 h) ou adulterado responde 400 INVALID_OR_EXPIRED_TOKEN
```

### CA-04 — Login

```gherkin
Dado um usuário com senha conhecida
Quando entra com credenciais corretas
Então recebe 200 com CurrentUser e os cookies __Host-tf_at e __Secure-tf_rt (HttpOnly, Secure)
Quando entra com senha errada ou e-mail inexistente
Então recebe 401 INVALID_CREDENTIALS com corpo idêntico nos dois casos
E a diferença de tempo médio entre os dois casos é inferior a 50 ms em 20 tentativas
```

### CA-05 — Rotação e reuso de refresh (BR-012)

```gherkin
Dado uma sessão com refresh R1
Quando o cliente renova com R1
Então recebe R2 e R1 deixa de ser o atual
Quando R1 é reapresentado em até 5 s pelo mesmo cliente (prefixo de IP e user agent)
Então a API responde 409 REFRESH_IN_PROGRESS e a sessão continua válida
Quando R1 é reapresentado uma segunda vez, após 5 s ou por outro cliente
Então a API responde 401 SESSION_REVOKED, a sessão é revogada (reuse_detected) e R2 também deixa de funcionar
```

Testes: `session.entity.spec.ts` (relógio controlado), `refresh-session.integration.spec.ts` (duas renovações concorrentes).

### CA-06 — Expiração (BR-015)

```gherkin
Dado uma sessão criada em T
Quando não há uso por mais de 7 dias
Então o refresh falha com 401 SESSION_EXPIRED
Dado uso contínuo
Quando passam 30 dias de T
Então o refresh falha com 401 SESSION_EXPIRED
```

### CA-07 — Logout e revogação imediata

```gherkin
Dado duas sessões A e B do mesmo usuário
Quando o usuário revoga B pela lista de sessões
Então requisições com o access token de B recebem 401 em até 1 s
E A continua funcionando
Quando o usuário faz logout em A
Então os cookies são limpos e o access token de A é rejeitado
E revogar uma sessão de outro usuário responde 404
```

### CA-08 — Recuperação de senha (BR-016)

```gherkin
Dado um usuário com duas sessões ativas
Quando solicita recuperação e redefine a senha pelo link
Então todas as sessões são revogadas, o e-mail fica verificado e o link não pode ser reutilizado
E a solicitação para e-mail inexistente responde 202 sem enviar e-mail
```

### CA-09 — Troca de senha

```gherkin
Dado um usuário autenticado na sessão A, com outra sessão B
Quando troca a senha informando a senha atual correta
Então B é revogada, A continua ativa com novo identificador de sessão e novos cookies
E o access token antigo de A é rejeitado, tokens de recuperação pendentes são invalidados e um aviso é enviado por e-mail
Quando informa a senha atual incorreta
Então recebe 403 CURRENT_PASSWORD_INCORRECT
```

### CA-10 — Rate limiting

```gherkin
Quando uma conta acumula 5 falhas consecutivas de login (de quaisquer IPs)
Então a tentativa seguinte exige espera progressiva e recebe 429 com Retry-After, mesmo com a senha correta
E um login bem-sucedido após a espera zera o contador
E os limites de cadastro, esqueci a senha e reenvio respondem 429 ao serem excedidos
```

### CA-11 — CSRF

```gherkin
Quando uma mutação chega sem header X-CSRF-Token igual ao cookie tf_csrf
Então a API responde 403 CSRF_VALIDATION_FAILED
Quando chega com Origin diferente de APP_ORIGIN
Então a API responde 403
```

### CA-12 — Política de senha (BR-011)

```gherkin
Quando a senha não atende algum requisito (tamanho, maiúscula, minúscula, dígito, símbolo, igual ao e-mail, presente na lista de senhas comuns)
Então a API responde 422 PASSWORD_POLICY_VIOLATION listando as regras não atendidas
E o formulário mostra os requisitos pendentes em tempo real, anunciados por leitor de tela
```

### CA-13 — Entrega com worker parado

```gherkin
Dado o worker parado
Quando um usuário se cadastra
Então a API responde 202 normalmente
Quando o worker inicia
Então exatamente um e-mail de verificação é entregue para o evento
E reprocessar o mesmo evento não cria segundo token
```

### CA-16 — Pré-sequestro de conta (BR-017)

```gherkin
Dado que um atacante cadastrou "vitima@exemplo.com" com uma senha dele
Quando a vítima clica no link de verificação recebido, sem estar logada naquela conta
Então o e-mail não é verificado
E o atacante continua sem conseguir entrar em organizações (BR-013)
```

### CA-17 — Remoção de contas não verificadas (RF-15)

```gherkin
Dado uma conta não verificada criada há 8 dias e sem login nos últimos 7 dias
Quando o job diário de limpeza executa
Então a conta e seus tokens são removidos e o e-mail pode ser cadastrado novamente
E contas verificadas ou com login recente não são afetadas
```

### CA-14 — Jornada E2E

```gherkin
Cadastro → e-mail no Mailpit → link de verificação → login → banner some → página de Segurança lista a sessão atual → logout → rota protegida redireciona ao login
```

### CA-15 — OpenAPI

```gherkin
Quando o documento /api/docs/openapi.json é gerado
Então é OpenAPI 3.1 válido e descreve todos os endpoints, schemas e respostas de erro desta spec
```

## Testes obrigatórios

- [x] Domínio: `Password` (BR-011), `Session.rotate` (BR-012/015), `User` (verificação, troca de senha)
- [x] Casos de uso com fakes: todos da tabela do design, incluindo caminhos de erro e eventos gravados
- [x] Integração (Testcontainers): repositórios, refresh concorrente, consumo de token concorrente, outbox relay + consumidor (Redis real)
- [x] HTTP (Supertest): status/contratos, cookies e seus atributos, CSRF, 401/404, rate limit
- [x] Frontend: formulários (validação e erros do servidor), `AuthStore`, interceptor de refresh (single-flight), guards
- [x] E2E: CA-14

## Evidências de validação

| Critério | Evidência (comando + resultado)                                                                                                                                                                                                     | Data       |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| CA-01    | `identity-router.spec.ts`, `send-identity-emails.use-cases.spec.ts`, `email-delivery.integration.spec.ts` (Mailpit real) — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`            | 2026-10-09 |
| CA-02    | `identity-router.spec.ts`, `send-identity-emails.use-cases.spec.ts`, `email-delivery.integration.spec.ts` — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                           | 2026-10-09 |
| CA-03    | `identity-router.spec.ts`, `verify-email.page.spec.ts`, E2E `email-and-password-links.spec.ts` e `auth-journey.spec.ts` — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`             | 2026-10-09 |
| CA-04    | `identity-router.spec.ts` (corpo idêntico); `login-timing.spec.ts` (Argon2 real, 20 tentativas, diferença < 50 ms) — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                  | 2026-10-09 |
| CA-05    | `identity-router.spec.ts`, `refresh-session.integration.spec.ts` (PostgreSQL real, corrida e reuso) — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                                 | 2026-10-09 |
| CA-06    | `identity-router.spec.ts` (7 dias de inatividade, 30 dias absolutos; navegador de teste respeita `Expires`) — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                         | 2026-10-09 |
| CA-07    | `identity-router.spec.ts`, `refresh-session.integration.spec.ts` (logout/revogação × refresh), `security.page.spec.ts` — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`              | 2026-10-09 |
| CA-08    | `identity-router.spec.ts`, `password.use-cases.spec.ts` — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                                                                             | 2026-10-09 |
| CA-09    | `identity-router.spec.ts`, `security.page.spec.ts` — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                                                                                  | 2026-10-09 |
| CA-10    | `identity-router.spec.ts`, `login.use-case.spec.ts` (BR-018, inclusive paralelo), `redis-login-attempt-tracker.integration.spec.ts` — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md` | 2026-10-09 |
| CA-11    | `identity-router.spec.ts`, `csrf.spec.ts`, `session-refresh.interceptor.spec.ts` — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                                                    | 2026-10-09 |
| CA-12    | `identity-router.spec.ts`, `password.spec.ts`, `register.page.spec.ts`, E2E `auth-pages.spec.ts` — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                                    | 2026-10-09 |
| CA-13    | `email-delivery.integration.spec.ts` (worker parado → entrega única; reprocessar não cria 2º token) — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                                 | 2026-10-09 |
| CA-14    | E2E `auth-journey.spec.ts` contra web, API, worker e Mailpit reais (banco descartável) — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                                              | 2026-10-09 |
| CA-15    | `openapi.spec.ts` (validado por `@readme/openapi-parser`) — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                                                                           | 2026-10-09 |
| CA-16    | `email-verification.use-cases.spec.ts`, `identity-router.spec.ts`, `verify-email.page.spec.ts`, E2E — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                                 | 2026-10-09 |
| CA-17    | `prisma-identity-data-retention.integration.spec.ts`, `maintenance.integration.spec.ts` — executado no gate da T30 (`pnpm verify`, `pnpm test:integration`, `pnpm e2e`), ver `tasks.md`                                             | 2026-10-09 |

## Definição de concluído

- [x] CA-01 a CA-17 comprovados por testes executados
- [x] `pnpm verify`, `pnpm test:integration` e `pnpm e2e` passando
- [x] `/review-code` sem bloqueantes e `/security-audit` sem achados Críticos/Altos abertos
- [x] BR-011…BR-016 em `docs/product/business-rules.md`; `docs/security/authentication.md` atualizado; ADRs 0005 e 0011 aceitos

> Revisão 4 do design (correções da T29) aprovada pelo usuário em 2026-10-09. **Spec concluída.**
