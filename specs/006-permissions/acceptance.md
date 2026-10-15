# 006 — Permissões · Aceitação

## Cenários

### CA-01 — Matrizes e negação por padrão

```gherkin
Dado cada papel de organização (owner, admin, member, viewer) e cada papel de projeto (manager, member, viewer)
Quando a política avalia cada permissão do catálogo
Então o resultado é exatamente o da matriz de docs/security/authorization.md (transcrita no teste)
E uma permissão fora do catálogo, 'constructor', '__proto__' ou um papel desconhecido são negados
```

### CA-02 — Papel efetivo no projeto (BR-023)

```gherkin
Dado um owner ou admin da organização sem participação no projeto
Então o papel efetivo é manager
Dado um member da organização com papel de projeto viewer
Então o papel efetivo é viewer
Dado um viewer da organização com papel de projeto manager
Então o papel efetivo é viewer
Dado um member ou viewer sem participação no projeto
Então não há papel efetivo (o projeto responde 404)
```

### CA-03 — Criação de projetos configurável (BR-024)

```gherkin
Dado a organização com "membros podem criar projetos" ativado
Então as capacidades de um member incluem project:create
Quando um admin desativa a opção com a versão atual
Então as capacidades do member não incluem project:create e as do owner/admin incluem
Quando um member tenta alterar a opção
Então a API responde 403
Quando a versão enviada está desatualizada
Então a API responde 409 VERSION_CONFLICT
```

### CA-04 — Capacidades da organização

```gherkin
Dado um viewer da organização
Quando consulta a organização ou "minhas organizações"
Então as capacidades contêm organization:read e não contêm organization:update nem member:invite
```

### CA-05 — Ações por membro

```gherkin
Dado um admin listando membros de uma organização com dois owners
Então os owners vêm sem ações (nem alterar papel nem remover)
E um member vem com changeRoleTo = [admin, member, viewer] e remove = true
```

### CA-06 — Interface guiada por capacidades

```gherkin
Dado a interface aberta como viewer
Então não há controles de papel, remoção, convites nem edição de configurações
E não existe matriz de permissões no código do frontend
Quando uma chamada forjada tenta a ação
Então a API responde 403
```

### CA-07 — Isolamento obrigatório por rota

```gherkin
Dado o escopo do tenant com todas as rotas das specs 002 e 006
Então cada rota tem o caso gerado (prefixo de outra organização ⇒ 404)
E cada referência (caminho, query, corpo) tem caso com id real de outra organização (404 e banco inalterado)
Quando uma rota tenant-scoped nova é montada sem caso, ou uma rota com :organizationId fica fora do escopo
Então o teste falha nomeando a rota
```

### CA-08 — RLS

```gherkin
Dado o ADR 0014
Então ele registra a avaliação, os gatilhos de reavaliação, a preparação barata e a decisão de adiar para a Fase 4
E o ADR 0004 aponta para ele na parte de RLS
```

### CA-09 — Atualização da organização sob lock

```gherkin
Dado um admin com uma atualização da organização em andamento
Quando um owner o rebaixa a viewer antes de a atualização obter o lock
Então a atualização é negada com 403 e nome e configuração ficam como estavam
```

## Testes obrigatórios

- [x] Kernel: matrizes tabela-driven, papel efetivo, negação por padrão
- [x] Domínio e casos de uso: configuração, capacidades, ações por membro
- [x] Integração: coluna nova, isolamento pelo harness (todas as rotas)
- [x] HTTP: contratos, 403/409, OpenAPI
- [x] Frontend: capacidades, ações, configuração
- [x] E2E: jornadas existentes verdes

## Evidências de validação

| Critério | Evidência (comando + resultado)                                                                                                                                                | Data       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| CA-01    | `authorization.spec.ts` do kernel (matrizes transcritas, chaves hostis) e `catalog-parity.spec.ts`; `nx test backend-shared-kernel` ✔ 142                                      | 2026-10-13 |
| CA-02    | `authorization.spec.ts` (BR-023, incluindo papéis desconhecidos) ✔                                                                                                             | 2026-10-13 |
| CA-03    | `organization.use-cases.spec.ts` (CA-03), `organizations-router.spec.ts` (CA-03), `settings.page.spec.ts` ✔                                                                    | 2026-10-13 |
| CA-04    | `organization.use-cases.spec.ts` (CA-04), `organizations-router.spec.ts` (CA-04 / CA-05) ✔                                                                                     | 2026-10-13 |
| CA-05    | `member.use-cases.spec.ts` ("member actions (spec 006, CA-05)"), `organizations-router.spec.ts` ✔                                                                              | 2026-10-13 |
| CA-06    | `members.page.spec.ts` (lista forjada sem ações, recarga falha), `settings.page.spec.ts`; chamada forjada ⇒ 403 em `organizations-router.spec.ts`; `role-policy.ts` removido ✔ | 2026-10-13 |
| CA-07    | `route-coverage.spec.ts` (rota sem caso falha; harness falha fechado) e `organizations-isolation.integration.spec.ts` ✔ 5/5                                                    | 2026-10-13 |
| CA-08    | Revisão do [ADR 0014](../../docs/architecture/adr/0014-rls-deferred.md) e do status do ADR 0004                                                                                | 2026-10-13 |
| CA-09    | `organization.use-cases.spec.ts` ("CA-09: decides on the role re-read under the organization lock") ✔                                                                          | 2026-10-13 |
| Gate     | `pnpm verify` ✔ 54/54; `pnpm test:integration` ✔ 120; Playwright ✔ 18/18                                                                                                       | 2026-10-13 |

## Definição de concluído

- [x] CA-01 a CA-09 comprovados por testes executados (CA-08 por revisão do ADR)
- [x] `pnpm verify`, `pnpm test:integration` e E2E passando
- [x] `/review-code` sem bloqueantes e `/security-audit` sem Críticos/Altos abertos
- [x] ADRs 0013 e 0014; documentação e roadmap atualizados
