---
name: security-audit
description: Auditoria de segurança focada do TaskFlow — autenticação, sessões e refresh tokens, autorização RBAC + recurso, isolamento entre tenants, validação de entrada, exposição de informações, segredos e pipeline. Use após mudanças em auth, permissões, queries tenant-scoped, endpoints, sockets ou infraestrutura, e antes de concluir specs de Identity & Access.
argument-hint: "[escopo: base-ref, caminho ou spec]"
context: fork
agent: security-reviewer
background: false
---

# Auditoria de segurança

Escopo: `$ARGUMENTS` (se vazio, as mudanças em relação a `master`).

1. Delimite o escopo (`git diff master...HEAD --stat`, ou os caminhos/spec indicados).
2. Leia `docs/security/*.md` e a spec relacionada.
3. Para cada endpoint, caso de uso, query e handler de socket/job no escopo, trace: origem da identidade → resolução do tenant → checagem de autorização → filtro na persistência → dados retornados/logados.
4. Procure especificamente:
   - queries Prisma sem `organizationId`; `findUnique` por `id` em tabela tenant-scoped;
   - confiança em `organizationId`/`userId`/`role` vindos do cliente;
   - 403 onde deveria ser 404 (vazamento de existência);
   - schemas Zod sem `.strict()` em comandos (mass assignment);
   - tokens/senhas/PII em logs ou respostas; segredos no código;
   - cookies sem `HttpOnly`/`Secure`/`SameSite`; ausência de CSRF em mutações por cookie; ausência de rate limit em endpoints sensíveis;
   - testes de isolamento e de 401/403/404 ausentes.
5. Rode `pnpm nx affected -t test` para confirmar que os testes de segurança existentes passam.

Entregue achados por severidade (Crítica/Alta/Média/Baixa) com `arquivo:linha`, cenário de exploração, impacto e correção, mais a lista do que foi verificado sem problemas. Não edite arquivos.
