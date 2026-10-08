---
paths:
  - 'apps/api/**'
  - 'apps/worker/**'
  - 'libs/backend/**'
  - 'apps/web/src/app/core/**'
  - 'libs/frontend/**/auth/**'
  - 'prisma/**'
  - '.env.example'
  - 'infra/**'
  - 'docker-compose.yml'
  - '.github/**'
---

# Regras de segurança

Referências: `docs/security/authentication.md`, `docs/security/authorization.md`, `docs/security/multi-tenancy.md`.

## Tenant isolation (risco nº 1)

- O tenant ativo é resolvido no servidor a partir da sessão autenticada + `Membership` válida. `organizationId` vindo do cliente (header, body, rota) é apenas **intenção**, validada contra as memberships.
- Recurso de outro tenant responde **404**, nunca 403 (não revelar existência).
- Todo caso de uso tenant-scoped recebe `RequestContext` com `organizationId` verificado. Repositórios aplicam o filtro.
- Toda feature tenant-scoped exige **teste de isolamento** (usuário da org A não lê/altera/lista dados da org B).

## Autenticação

- Access token JWT curto (≤ 15 min), refresh token opaco e rotativo, armazenado como hash; reutilização de refresh revoga a família de sessões.
- Cookies `HttpOnly`, `Secure`, `SameSite=Lax|Strict`, `Path` restrito no refresh. Nada de token em `localStorage`.
- Mutações autenticadas por cookie exigem proteção CSRF (double-submit token ou verificação de `Origin`), conforme ADR 0005.
- Senhas com Argon2id (parâmetros OWASP), nunca logadas. Mensagens de login/recuperação não revelam se o e-mail existe.
- Rate limiting em login, registro, refresh, recuperação de senha e convites.

## Autorização

- RBAC (papéis em `docs/security/authorization.md`) **e** checagem no recurso (membro do projeto, dono da tarefa…). Verificar no caso de uso, não no controller nem só no frontend.
- Negar por padrão: nova ação sem política explícita = proibida.

## Dados e segredos

- Segredos somente via variáveis de ambiente validadas; `.env` nunca versionado; `.env.example` sem valores reais.
- Validação Zod em toda fronteira (HTTP, filas, sockets, env). Rejeite campos desconhecidos em comandos (`.strict()`).
- Respostas não incluem hashes, tokens, campos internos ou dados de outros tenants. Mapeie explicitamente para contratos.
- Logs com redação de credenciais e PII desnecessária.

## OWASP / abuso

- Helmet, CORS restrito por allowlist (quando houver origem distinta), limites de payload e paginação, timeouts.
- Sem SQL dinâmico; sem `eval`/`Function`; uploads (futuro) com validação de tipo/tamanho e armazenamento fora do webroot.
- Dependências novas exigem justificativa; scripts de instalação ficam bloqueados por padrão (`allowBuilds` em `pnpm-workspace.yaml`).
