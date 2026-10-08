# TaskFlow — instruções do projeto

SaaS multi-tenant de gestão de projetos e tarefas (referências: Jira, Linear, ClickUp). Projeto de portfólio tratado como produto real: engenharia sustentável, desenvolvimento incremental, sem CRUD de demonstração.

## Stack (versões e motivos em `docs/architecture/adr/0002-stack-and-versions.md`)

- **Monorepo**: Nx 23 + pnpm 11, Node.js 24 LTS, TypeScript 6.0 (strict). Path aliases `@taskflow/*` em `tsconfig.base.json`.
- **Frontend** `apps/web`: Angular 22 (standalone, zoneless, Signals), Angular Material/CDK, Tailwind CSS 4, Vitest, Playwright.
- **Backend** `apps/api`: Express 5, Prisma 7 + PostgreSQL, Zod, Pino, Redis. Planejados por spec: JWT + refresh rotativo, Argon2id, BullMQ (`apps/worker`), Socket.IO, OpenAPI 3.1.
- **Infra**: Docker Compose (PostgreSQL + Redis), GitHub Actions, Testcontainers.

## Arquitetura (detalhes em `docs/architecture/`)

- **Modular Monolith** por bounded context, Clean Architecture + DDD pragmático. Contextos em `docs/architecture/bounded-contexts.md`.
- Camadas por contexto: `domain` → `application` → `infrastructure` / `http`. Domain não importa Express, Prisma, Redis nem Socket.IO.
- Módulos não acessam repositórios/tabelas uns dos outros; integração via portas na `application` ligadas no composition root (`apps/api`).
- Limites verificados por tags Nx + `@nx/enforce-module-boundaries` (`eslint.config.mjs`). Regras em `docs/architecture/dependency-rules.md`.
- Sem microsserviços, Kubernetes, NgRx Store, CQRS completo, Event Sourcing ou framework de DI.

## Convenções essenciais

- **Código em inglês** (identificadores, arquivos, endpoints, tabelas, eventos). **Comentários, docs, ADRs e specs em português brasileiro.** Textos de UI em pt-BR, preparados para i18n.
- Commits: Conventional Commits em inglês.
- Sem `any`, sem casts inseguros, sem erros engolidos, sem segredos versionados, sem implementações fictícias apresentadas como completas.
- Detalhes por área em `.claude/rules/` (carregadas automaticamente pelo caminho do arquivo editado).

## Segurança (inegociável — `docs/security/`)

- Multi-tenancy por `organizationId` em banco compartilhado. Nunca confiar no `organizationId` enviado pelo cliente: o backend resolve o tenant a partir da sessão + associação de membro.
- Autorização = RBAC **e** verificação no recurso específico. Toda query tenant-scoped filtra pela organização ativa.
- Tokens nunca em `localStorage`. Logs nunca contêm senhas, tokens ou dados pessoais desnecessários.

## Processo: Spec-Driven Development (`specs/README.md`)

1. Funcionalidade relevante **exige spec aprovada** em `specs/NNN-nome/` (`requirements.md` → `design.md` → `tasks.md` → `acceptance.md`) antes de código.
2. Mudanças triviais (typo, ajuste de config, bug local) usam spec proporcional ou nenhuma — registrar o motivo no commit.
3. Implementar uma tarefa de `tasks.md` por vez, com testes, marcando o progresso no próprio arquivo.
4. Não alterar decisão aprovada (ADR/spec) silenciosamente: propor novo ADR ou revisão da spec.
5. Regras de negócio canônicas (BR-001…BR-010) em `docs/product/business-rules.md`.

Skills disponíveis: `/implement-spec`, `/create-feature`, `/create-domain-module`, `/create-api-endpoint`, `/create-angular-feature`, `/database-migration`, `/write-tests`, `/review-code`, `/security-audit`, `/create-adr`. Agentes especialistas em `.claude/agents/` (uso guiado em `docs/context-engineering.md`).

## Comandos

```bash
pnpm install                    # dependências (scripts de build liberados em pnpm-workspace.yaml)
pnpm infra:up                   # PostgreSQL + Redis via Docker Compose
pnpm db:generate                # gera o Prisma Client
pnpm db:migrate                 # cria/aplica migrations em desenvolvimento
pnpm dev                        # API (3333) + web (4200)
pnpm lint | pnpm typecheck | pnpm test | pnpm build
pnpm test:integration           # Testcontainers (requer Docker)
pnpm e2e                        # Playwright
pnpm verify                     # lint + typecheck + test + build (gate local)
```

Executar tarefas sempre via Nx (`pnpm nx run <projeto>:<target>`, `pnpm nx affected -t ...`).

## Definição de pronto

Uma tarefa só está concluída quando: critérios de aceitação da spec atendidos; testes novos/alterados passando; `pnpm verify` executado **e passando**; documentação/ADR atualizados quando aplicável; nenhuma violação de boundaries. Ao reportar, distinguir explicitamente **implementado, testado, documentado, planejado e pendente** — nunca afirmar sucesso sem evidência de execução.

## Mapa de contexto

| Preciso de… | Onde |
| --- | --- |
| Visão de produto e roadmap | `docs/product/vision.md`, `docs/product/roadmap.md` |
| Arquitetura e fluxos | `docs/architecture/overview.md`, `docs/architecture/data-flow.md` |
| Decisões registradas | `docs/architecture/adr/` |
| Autenticação, autorização, tenancy | `docs/security/` |
| Setup, workflow, testes, convenções | `docs/development/` |
| Design System | `docs/design-system.md` |
| Como agentes/skills/regras se organizam | `docs/context-engineering.md` |
