---
paths:
  - 'apps/api/**'
  - 'libs/backend/**/http/**'
  - 'libs/contracts/**'
  - 'docs/api/**'
---

# Regras de design de API REST

- Prefixo versionado: `/api/v1`. Endpoints operacionais fora da versão: `/health/live`, `/health/ready`.
- Recursos no plural, kebab-case, inglês. Recursos tenant-scoped vivem sob o prefixo do tenant (ADR 0012), que conta como o nível de aninhamento permitido: `/api/v1/organizations/{organizationId}/projects/{projectId}`, `/api/v1/organizations/{organizationId}/tasks?projectId=…`; aninhamentos mais profundos viram filtros.
- O `organizationId` do caminho é **intenção**, nunca prova (ADR 0012): `createTenantScope` monta `authenticate → csrf → tenantContext` uma vez sobre o prefixo, valida a membership a cada request e entrega `TenantRequestContext`. Routers tenant-scoped são montados **só** dentro desse escopo (`mergeParams`), com caminhos relativos; controllers usam `tenantRequestContextFrom(request)`. Rotas sem organização ativa (criar organização, `/me/...`, aceite de convite, identidade) ficam fora do prefixo. Uma rota usa uma única origem para o tenant (nunca caminho e header juntos).
- Verbos: `GET` (seguro), `POST` (criar/ação), `PATCH` (alteração parcial com `version`), `PUT` (substituição completa, raro), `DELETE`.
- Ações de domínio que não são CRUD viram sub-recursos de ação: `POST /tasks/{id}/complete`, `POST /sprints/{id}/close`, `POST /boards/{id}/moves`.
- Concorrência: `PATCH`/ações enviam `version` (ou `If-Match` com ETag); conflito → `409` com `code: VERSION_CONFLICT`.
- Idempotência: `POST` sensível a duplicidade aceita `Idempotency-Key`.
- Respostas em JSON camelCase. Datas ISO 8601 UTC. IDs como string UUID.
- Listas: `{ items, nextCursor }` com `limit` (padrão 25, máx. 100). Nunca listas ilimitadas.
- Erros: sempre `application/problem+json` (`ProblemDetails` de `@taskflow/contracts`), com `code` estável e `requestId`.
- Status: 200/201 (com `Location`)/204; 400/422 validação; 401; 403; 404 (inclui outro tenant); 409; 429; 500.
- Contratos de request/response vivem em `libs/contracts` (schemas Zod) e são a fonte para o OpenAPI 3.1 (gerado a partir dos schemas) e para os tipos do frontend.
- Toda mudança de contrato atualiza OpenAPI, testes de contrato e o `design.md` da spec. Mudança incompatível exige nova versão ou janela de depreciação documentada.
