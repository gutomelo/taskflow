---
name: create-api-endpoint
description: Padroniza a criação de um endpoint REST no backend Express do TaskFlow — método, URI, autenticação, autorização, validação Zod, contrato em libs/contracts, caso de uso, erros Problem Details, OpenAPI e testes Supertest. Use ao adicionar ou alterar um endpoint previsto no design.md de uma spec.
argument-hint: "<MÉTODO /api/v1/rota> [spec]"
---

# Criar endpoint de API

Endpoint: $ARGUMENTS

Siga `.claude/rules/api-design.md` e `.claude/rules/express.md`. O endpoint precisa estar descrito no `design.md` de uma spec aprovada.

## Ficha do endpoint (preencha antes de codar)

| Item | Valor |
| --- | --- |
| Método + URI | |
| Caso de uso | `<Verb><Noun>UseCase` |
| Autenticação | pública / autenticada |
| Autorização | papel(éis) + checagem de recurso (quem pode, sobre o quê) |
| Tenant | como o `organizationId` é obtido e verificado |
| Entrada | params, query, body (schema Zod `.strict()`) |
| Saída | contrato de resposta + status de sucesso |
| Erros | códigos (`code`) e status possíveis |
| Concorrência / idempotência | `version`, `Idempotency-Key` |
| Rate limit | se sensível |

## Passos

1. **Contrato**: schemas Zod de request/response em `libs/contracts/src/lib/<context>/` e export no `index.ts`.
2. **Caso de uso** na `application` do contexto (testado com fakes) — recebe `RequestContext` + comando tipado.
3. **Controller/router** na lib `http` do contexto: valida entrada com o schema, chama o caso de uso, mapeia a saída para o contrato. Sem lógica de negócio.
4. **Wiring** no composition root (`apps/api`), aplicando middlewares de auth/tenant/rate limit.
5. **Erros**: use erros tipados existentes; novos `code` documentados no `design.md`.
6. **OpenAPI**: registre o path com os mesmos schemas (fonte única).
7. **Testes Supertest** (mínimo): sucesso; entrada inválida (400/422); sem autenticação (401); sem permissão (403); recurso de outra organização (404); conflito (409) quando houver `version`.
8. Verifique: `pnpm nx affected -t lint typecheck test`.

Saída esperada: ficha preenchida, arquivos criados/alterados e resultado real dos testes.
