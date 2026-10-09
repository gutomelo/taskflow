# 0012 — Organização ativa transmitida no caminho da API (`/organizations/{organizationId}/…`)

- **Status**: Aceito (2026-10-09, com a aprovação da spec 002)
- **Data**: 2026-10-09
- **Decisores**: usuário (product owner); arquitetura (Claude Code, revisão da spec 002)
- **Relacionados**: [ADR 0004](0004-multi-tenancy-shared-database.md), [ADR 0003](0003-modular-monolith-clean-architecture.md), [spec 002](../../../specs/002-organizations/design.md), [multi-tenancy](../../security/multi-tenancy.md)

## Contexto

O ADR 0004 exige que o tenant seja resolvido no servidor (sessão + membership) a cada requisição, mas não fixa como o cliente indica a organização desejada. A documentação divergia: a regra de API falava em "organização ativa da sessão", `multi-tenancy.md` em header `X-Organization-Id` "a confirmar na spec 002", e o primeiro rascunho da spec 002 usava caminho para administrar a organização e deixava o resto em aberto. A spec 002 entrega o middleware de contexto de tenant que as specs 003+ (projetos, tarefas, quadros) reutilizam: deixar o mecanismo aberto tornaria provisórios o middleware, o data-access do frontend e os testes de isolamento. O app identifica a organização na URL (`/o/:slug`) e o usuário pode trabalhar em organizações diferentes em abas diferentes.

## Alternativas consideradas

### A — Header `X-Organization-Id` em toda requisição tenant-scoped

- Prós: URLs curtas; trocar de organização só muda o header.
- Contras: convive com o caminho já natural para administrar a organização (dois mecanismos); estado implícito num interceptor do frontend, com risco de requisições em voo saírem com a organização errada durante a troca; cada router precisa lembrar de aplicar o middleware.

### B — Organização ativa armazenada na sessão do servidor

- Prós: o cliente não envia nada.
- Contras: impede abas simultâneas em organizações diferentes; trocar de organização vira mutação de sessão; contradiz a organização na URL do app.

### C — Prefixo de caminho `/api/v1/organizations/{organizationId}/…`

- Prós: um único mecanismo para administração e recursos de negócio; o composition root monta `authenticate → csrf → tenantContext` uma vez sobre o prefixo e todo router montado ali fica protegido por construção; tenant explícito em logs, testes e reprodução de bugs; sem estado oculto no cliente.
- Contras: URLs mais longas; exige esclarecer a regra de aninhamento da API.

## Decisão

Adotamos **C**.

1. Todo recurso tenant-scoped é exposto sob `/api/v1/organizations/{organizationId}/…`. O `organizationId` da rota é **intenção**, nunca prova.
2. `createTenantContext` (`libs/backend/shared/http`) lê somente `request.params.organizationId`, valida o formato UUID (inválido ⇒ 404), exige `request.actor` e chama um resolvedor injetado (caso de uso de consulta de `organizations`, ligado no composition root) que faz **uma** consulta pelo índice único `(organization_id, user_id)`, sem cache além da requisição. Sem membership ou organização inexistente ⇒ 404 idêntico. Papel desconhecido ⇒ negado.
3. O resultado vira `TenantRequestContext` (`libs/backend/shared/application`: `RequestContext & { tenant: { organizationId; organizationRole: OrganizationRole } }`), obtido nos controllers apenas por `tenantRequestContextFrom(request)`, que falha fechado se o middleware não rodou.
4. O composition root monta um router de tenant único; os routers dos contextos são montados nele com `mergeParams: true`. Uma rota usa uma única origem para o tenant (nunca caminho e header juntos).
5. O prefixo do tenant conta como o nível de aninhamento permitido: `/organizations/{o}/projects/{p}` e `/organizations/{o}/tasks?projectId=…`; aninhamentos mais profundos viram filtros.
6. Repositórios continuam filtrando por `organizationId` em toda leitura **e escrita**: um id de recurso de outra organização sob o prefixo correto responde 404.
7. Rotas não tenant-scoped (`/me/organizations`, `POST /organizations`, `/invitations/lookup|accept`, identidade) ficam fora do prefixo.
8. No frontend, o data-access monta a URL a partir da organização resolvida da rota `/o/:slug`; não há interceptor que injete o tenant.

## Consequências

- **Positivas**: um único caminho de código para o tenant; esquecer o middleware deixa de ser possível para routers montados no prefixo; troca de organização sem corrida no cliente; abas independentes.
- **Negativas / custos**: URLs mais longas; `.claude/rules/api-design.md`, `docs/security/multi-tenancy.md` e `.claude/rules/security.md` precisam ser atualizados; routers dos contextos dependem de `mergeParams`.
- **Riscos e mitigação**: router tenant-scoped montado fora do prefixo — mitigado por `tenantRequestContextFrom` falhar fechado, por teste que percorre a tabela de rotas e pelos testes A/B obrigatórios; id de recurso de outra organização — mitigado pelo filtro obrigatório nos repositórios.
- **Como verificar**: testes de integração A/B por endpoint (RNF-01 da spec 002); testes do middleware (UUID inválido, sem membership, inexistente ⇒ 404 idêntico; sem actor ⇒ 401); `/review-code` e `/security-audit` checam montagem sob o prefixo e uso de `tenantRequestContextFrom`.

## Referências

- ADR 0004 (multi-tenancy com banco compartilhado), ADR 0003 (modular monolith), ADR 0006 (lock pessimista curto para invariantes de várias linhas)
- Express 5 — `Router({ mergeParams: true })`
