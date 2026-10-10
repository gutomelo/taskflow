# 002 — Organizações e multi-tenancy · Critérios de aceitação

Cenários em Given/When/Then (em pt-BR). Cada cenário vira teste automatizado no nível indicado; o ID aparece no nome do teste.

### CA-01 — Criar organização (BR-013)

```gherkin
Dado um usuário autenticado com e-mail verificado
Quando cria a organização "Acme" com slug "acme"
Então a API responde 201 com a organização e o cabeçalho Location
E o usuário é membro com papel owner
Dado um usuário com e-mail não verificado
Quando tenta criar uma organização
Então a API responde 403 EMAIL_NOT_VERIFIED e nada é criado
```

Testes: casos de uso, HTTP, formulário de onboarding.

### CA-02 — Slug (BR-022)

```gherkin
Quando o slug é inválido ("Acme", "a", "acme-", "a--b", "1acme") ou reservado ("admin", "taskflow")
Então a API responde 400 INVALID_SLUG
Quando o slug já está em uso por outra organização
Então a API responde 409 SLUG_TAKEN
E não existe operação que altere o slug de uma organização
```

### CA-03 — Isolamento entre organizações (RNF-01)

```gherkin
Dado Ana membro de A e Bruno membro apenas de B
Quando Bruno chama qualquer endpoint sob /organizations/{A}/… — inclusive com ids reais de membros e convites de A
Então todas as respostas são 404, idênticas às de uma organização inexistente
E nenhum dado de A é alterado
E um organizationId que não é UUID também responde 404
```

Testes: integração com PostgreSQL, um caso por endpoint.

### CA-04 — Convite aceito pela conta convidada (BR-020)

```gherkin
Dado que Ana (owner de A) convida "bia@exemplo.com" como member
Quando o worker processa o evento
Então o Mailpit recebe o e-mail com link /invitations/accept#token=… e o nome de A entre aspas
Quando Bia, autenticada com esse e-mail verificado, consulta o convite e clica em Aceitar
Então Bia vira membro de A com papel member e o convite não pode ser reutilizado
```

### CA-05 — Convite: conta errada, expirado, revogado (BR-020, BR-013)

```gherkin
Quando outra conta tenta aceitar o convite de Bia
Então a API responde 403 INVITATION_FOR_ANOTHER_ACCOUNT e o convite continua válido para Bia
Quando Bia aceita sem ter verificado o e-mail
Então a API responde 403 EMAIL_NOT_VERIFIED e o convite continua válido
Quando o convite está expirado, revogado ou já foi aceito
Então a API responde 400 INVALID_OR_EXPIRED_INVITATION
Quando o convidante foi removido da organização antes do aceite
Então o convite foi revogado e o aceite falha
```

### CA-06 — Reenviar e reconvidar

```gherkin
Quando Ana reenvia o convite de Bia
Então o link anterior deixa de funcionar e o novo funciona
E um evento de envio antigo processado depois não invalida o link mais recente
Quando Ana convida de novo "bia@exemplo.com" com papel admin
Então o convite aberto passa a ter papel admin e um novo link é enviado
Quando Ana convida alguém que já é membro
Então a API responde 409 ALREADY_A_MEMBER
```

### CA-07 — Hierarquia de papéis (BR-021)

```gherkin
Dado Ana owner, Carlos admin e Dani member
Quando Carlos promove Dani a owner, ou altera/remove Ana
Então a API responde 403 ROLE_CHANGE_NOT_ALLOWED e nada muda
Quando Carlos promove Dani a admin
Então Dani passa a admin
Quando Dani (member) tenta convidar alguém ou alterar papéis
Então a API responde 403
Quando Ana promove Dani a owner
Então Dani passa a owner
```

Testes: tabela-driven pela matriz de `authorization.md`.

### CA-08 — Sempre um owner (BR-019)

```gherkin
Dado Ana como única owner
Quando Ana tenta sair, se rebaixar ou ser removida
Então a API responde 409 LAST_OWNER
Dado Ana e Eva como owners
Quando cada uma rebaixa a outra ao mesmo tempo
Então exatamente uma operação sucede e a outra recebe 409 LAST_OWNER (a organização continua com um owner)
Quando Eva é rebaixada enquanto uma requisição dela tenta promover outra pessoa a owner
Então a promoção é negada (papel relido sob lock)
```

Testes: casos de uso; integração concorrente com PostgreSQL.

### CA-09 — Remoção tem efeito imediato

```gherkin
Dado Bia membro de A
Quando Ana remove Bia
Então a próxima requisição de Bia a /organizations/{A}/… responde 404
E os convites abertos criados por Bia são revogados
Quando Bia sai de A por conta própria
Então o mesmo vale
```

### CA-10 — Navegação por organização

```gherkin
Dado um usuário membro de A ("acme") e B ("beta")
Quando abre /o/acme
Então vê a organização A
Quando troca para B pelo seletor
Então a URL passa a /o/beta e nenhum dado de A permanece na tela
Quando abre /o/slug-que-nao-e-seu
Então vê "Organização não encontrada" com link para suas organizações
Dado um usuário verificado sem organizações
Quando abre /
Então é levado ao onboarding para criar uma organização
```

### CA-11 — Jornada E2E

```gherkin
Owner cria organização → convida e-mail → convidado se cadastra, verifica o e-mail e aceita pelo link do Mailpit →
aparece na lista de membros → owner altera o papel → convidado sai da organização
```

### CA-12 — Limites

```gherkin
Quando um usuário excede a criação de organizações, ou uma organização/conta excede convites
Então a API responde 429 com Retry-After
Quando o mesmo endereço já recebeu o máximo de convites no dia (somando organizações)
Então novos convites para ele são aceitos pela API mas o envio é suprimido em silêncio
```

## Testes obrigatórios

- [x] Domínio: slug e nome (BR-022), política de papéis (BR-021, tabela-driven)
- [x] Casos de uso com fakes: todos, incluindo caminhos de erro, limites e eventos gravados
- [x] Integração (Testcontainers): constraints, lock e concorrência (BR-019/BR-021), aceite × revogação, isolamento A/B por endpoint, worker com Mailpit (reenvio e eventos fora de ordem)
- [x] HTTP (Supertest): contratos, 401/403/404, CSRF, limites, teste da tabela de rotas
- [x] Frontend: store da organização ativa, onboarding, membros, convites, aceite
- [x] E2E: CA-11

## Evidências de validação

| Critério | Evidência (comando + resultado)                                                                                                                                                                                                                                                    | Data       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| CA-01    | Casos de uso (`organization.use-cases.spec.ts`), HTTP 201 + `Location` e 403 `EMAIL_NOT_VERIFIED` (`organizations-router.spec.ts`), página de criação, jornada E2E — `pnpm verify` ✔, Playwright 18/18                                                                             | 2026-10-10 |
| CA-02    | Domínio (slug: formato, reservados), casos de uso e HTTP (`INVALID_SLUG` 400, `SLUG_TAKEN` 409), erros no campo da página; renomear não altera o slug — `pnpm verify` ✔                                                                                                            | 2026-10-10 |
| CA-03    | `apps/api/.../organizations-isolation.integration.spec.ts`: 9 endpoints sob o prefixo de B ⇒ 404 idêntico; ids reais de B sob o prefixo de A ⇒ 404 e banco de B inalterado; tabela de rotas (401/404 por rota) — `pnpm test:integration` ✔ (api 4/4)                               | 2026-10-10 |
| CA-04    | Worker com Mailpit (`email-delivery.integration.spec.ts`: convite entregue, link resolve o convite); aceite com o papel do convite (casos de uso, HTTP, página); jornada E2E — `pnpm test:integration` ✔ (worker 9/9), Playwright ✔                                                | 2026-10-10 |
| CA-05    | Aceite por outra conta ⇒ 403 sem consumir; usado/revogado/expirado/desconhecido ⇒ 400 indistinto (casos de uso, HTTP, página) — `pnpm verify` ✔                                                                                                                                    | 2026-10-10 |
| CA-06    | Reenvio invalida o link na hora (repositório: `token_hash` apagado ao trocar de envio), evento antigo descartado (caso de uso e Mailpit), revogação impede o aceite; aceite × revogação concorrentes com um vencedor — `pnpm test:integration` ✔                                   | 2026-10-10 |
| CA-07    | Matriz de papéis tabela-driven (domínio), casos de uso, HTTP e componentes (admin sem opção owner nem ações sobre owners) — `pnpm verify` ✔                                                                                                                                        | 2026-10-10 |
| CA-08    | Último owner ⇒ `LAST_OWNER` (casos de uso, HTTP, alerta na página); concorrência com PostgreSQL: rebaixamento mútuo e saída simultânea deixam 1 owner; ator rebaixado no meio não conclui (`membership-concurrency.integration.spec.ts`) — `pnpm test:integration` ✔               | 2026-10-10 |
| CA-09    | Removido ⇒ 404 na próxima requisição (API real) e `/organizations` com aviso no frontend (interceptor); saída na jornada E2E — `pnpm test:integration` ✔, Playwright ✔                                                                                                             | 2026-10-10 |
| CA-10    | Roteamento com `RouterTestingHarness` (última, primeira, onboarding, troca recria a área), seletor no cabeçalho; jornada E2E — `pnpm verify` ✔, Playwright ✔                                                                                                                       | 2026-10-10 |
| CA-11    | `apps/web-e2e/src/organizations-journey.spec.ts` (real, Mailpit) — Playwright ✔ 18/18 duas vezes                                                                                                                                                                                   | 2026-10-10 |
| CA-12    | 429 com `Retry-After` na criação (5/dia), convites por conta/organização/(organização, e-mail), lookup/accept; supressão silenciosa no 4º e-mail ao mesmo destinatário — casos de uso e HTTP, `pnpm verify` ✔. Achado M1 da auditoria sobre esse limite aguarda decisão do usuário | 2026-10-10 |

## Definição de concluído

- [x] CA-01 a CA-12 comprovados por testes executados
- [x] `pnpm verify`, `pnpm test:integration` e `pnpm e2e` passando
- [x] `/review-code` sem bloqueantes e `/security-audit` sem achados Críticos/Altos abertos
- [x] BR-019…BR-022 e desvio da BR-007 em `business-rules.md`; `multi-tenancy.md`, `authorization.md` e regras atualizados; ADR 0012 aceito
