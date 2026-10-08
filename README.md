# TaskFlow

Plataforma SaaS multi-tenant de gestão de projetos e tarefas — Kanban, sprints, colaboração em tempo real e regras de negócio aplicadas pelo sistema.

> **Estado atual: Fase 0 (Fundação).** Arquitetura, processo, qualidade e infraestrutura prontos; as funcionalidades de produto começam na Fase 1, a partir da spec `001-authentication`. Veja o [roadmap](docs/product/roadmap.md).

## Stack

| Camada     | Tecnologias                                                                      |
| ---------- | -------------------------------------------------------------------------------- |
| Frontend   | Angular 22 (standalone, zoneless, Signals), Angular Material/CDK, Tailwind CSS 4 |
| Backend    | Node.js 24, Express 5, TypeScript 6 (strict), Zod, Pino                          |
| Dados      | PostgreSQL 18, Prisma 7, Redis 8                                                 |
| Qualidade  | Vitest, Supertest, Testcontainers, Playwright, ESLint 10, Prettier               |
| Plataforma | Nx 23, pnpm 11, Docker Compose, GitHub Actions, Dependabot                       |

Planejados por spec: JWT com refresh token rotativo, Argon2id, Socket.IO, BullMQ, OpenAPI 3.1, OpenTelemetry. Versões e motivos: [ADR 0002](docs/architecture/adr/0002-stack-and-versions.md).

## Arquitetura em uma frase

**Modular monolith** com bounded contexts isolados em bibliotecas Nx por camada (domain → application → infrastructure/http), limites verificados automaticamente no lint, e multi-tenancy por `organizationId` validado no servidor. Detalhes em [docs/architecture/overview.md](docs/architecture/overview.md).

## Começando

Pré-requisitos: Node.js 24, pnpm 11, Docker.

```bash
pnpm install
cp .env.example .env
pnpm infra:up        # PostgreSQL e Redis
pnpm dev             # API :3333 · Web :4200
```

Mais comandos e solução de problemas: [docs/development/setup.md](docs/development/setup.md).

## Qualidade

```bash
pnpm verify             # lint (inclui limites de arquitetura) + typecheck + testes + build
pnpm test:integration   # PostgreSQL/Redis reais via Testcontainers
pnpm e2e                # Playwright
```

## Como o projeto é desenvolvido

- **Spec-Driven Development**: nenhuma funcionalidade relevante sem especificação aprovada — [specs/README.md](specs/README.md).
- **Decisões registradas** em [ADRs](docs/architecture/adr/README.md).
- **Desenvolvimento assistido por IA** com Claude Code: contexto em camadas (`CLAUDE.md`, regras por caminho, skills, agentes especialistas e hooks) — [docs/context-engineering.md](docs/context-engineering.md).

## Documentação

| Tema            | Documento                                                                                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Produto         | [Visão](docs/product/vision.md) · [Roadmap](docs/product/roadmap.md) · [Regras de negócio](docs/product/business-rules.md)                                                                                  |
| Arquitetura     | [Visão geral](docs/architecture/overview.md) · [Bounded contexts](docs/architecture/bounded-contexts.md) · [Dependências](docs/architecture/dependency-rules.md) · [Fluxos](docs/architecture/data-flow.md) |
| Segurança       | [Autenticação](docs/security/authentication.md) · [Autorização](docs/security/authorization.md) · [Multi-tenancy](docs/security/multi-tenancy.md)                                                           |
| Desenvolvimento | [Setup](docs/development/setup.md) · [Workflow](docs/development/workflow.md) · [Testes](docs/development/testing.md) · [Convenções](docs/development/conventions.md)                                       |
| Interface       | [Design System](docs/design-system.md)                                                                                                                                                                      |
