# 000 — Fundação do projeto · Requisitos

- **Status**: Concluído (aprovado pelo brief da primeira execução; validado em 2026-10-08)
- **Fase do roadmap**: 0 — Fundação
- **Bounded contexts**: nenhum de negócio (infraestrutura transversal)

## Objetivo

Entregar um monorepo funcional, documentado e verificável sobre o qual as features do MVP possam ser especificadas e implementadas incrementalmente, com assistência de IA guiada por contexto.

## Problema resolvido

Sem fundação, cada feature reinventaria configuração, convenções e limites, e agentes de IA produziriam código inconsistente. A fundação fixa stack, arquitetura, processo e qualidade antes da primeira regra de negócio.

## Escopo

### Inclui

- Context engineering para Claude Code (CLAUDE.md, regras, agentes, skills, hooks, permissões).
- Documentação de arquitetura, ADRs, regras de negócio, matriz de permissões, roadmap, Design System.
- Processo SDD com templates.
- Monorepo Nx com `apps/web` (Angular), `apps/api` (Express), `apps/web-e2e`, `libs/contracts`, `libs/backend/shared/infrastructure`.
- Limites de dependência verificáveis (tags + ESLint).
- Prisma 7 configurado (sem modelos de negócio).
- Docker Compose com PostgreSQL e Redis; Dockerfiles de produção opcionais.
- API mínima: configuração validada, logging estruturado, Problem Details, health checks.
- Web mínima: tokens de Design System, tema Material + Tailwind, shell e página de status do sistema.
- Scripts de desenvolvimento e qualidade; CI no GitHub Actions; Dependabot.

### Não inclui

- Autenticação, organizações, permissões, projetos, tarefas, Kanban (Fase 1).
- Socket.IO, BullMQ/`apps/worker`, OpenAPI/Swagger UI, OpenTelemetry (fases seguintes — chegam com o primeiro endpoint de negócio, a primeira fila e a Fase 4).
- Deploy real.

## Requisitos funcionais

| ID    | Requisito                                                                                                                                             | Prioridade |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RF-01 | `GET /health/live` responde 200 `{ status: "ok" }` sem consultar dependências.                                                                        | Must       |
| RF-02 | `GET /health/ready` verifica PostgreSQL e Redis em paralelo, com timeout, e responde 200 `ready` ou 503 `not_ready` com o estado de cada dependência. | Must       |
| RF-03 | Rotas inexistentes e erros inesperados respondem `application/problem+json` com `code` e `requestId`, sem detalhes internos.                          | Must       |
| RF-04 | A API não inicia com configuração inválida e informa quais variáveis estão erradas (sem exibir valores secretos).                                     | Must       |
| RF-05 | A web exibe a página "Status do sistema" com estados de carregamento, sucesso e erro, consumindo `/health/ready`.                                     | Must       |
| RF-06 | Um comando sobe as dependências locais (PostgreSQL, Redis) com healthcheck.                                                                           | Must       |
| RF-07 | Um comando executa lint, typecheck, testes e build de todo o workspace.                                                                               | Must       |

## Requisitos não funcionais

| ID     | Categoria         | Requisito                                                                                                 |
| ------ | ----------------- | --------------------------------------------------------------------------------------------------------- |
| RNF-01 | Segurança         | Nenhum segredo versionado; `.env.example` sem valores reais de produção; logs com redação de credenciais. |
| RNF-02 | Segurança         | Headers de segurança (Helmet), `x-powered-by` desabilitado, limite de payload JSON.                       |
| RNF-03 | Operação          | Graceful shutdown em `SIGTERM`/`SIGINT` fechando servidor HTTP, Prisma e Redis.                           |
| RNF-04 | Arquitetura       | Violação de limites entre projetos falha o lint.                                                          |
| RNF-05 | Qualidade         | TypeScript strict sem `any`; lint e typecheck sem erros.                                                  |
| RNF-06 | Desempenho        | `/health/ready` responde em ≤ timeout configurado (padrão 2 s) mesmo com dependência indisponível.        |
| RNF-07 | Acessibilidade    | Página de status com estrutura semântica, `aria-live` para mudança de estado e contraste AA.              |
| RNF-08 | Reprodutibilidade | Instalação determinística (`--frozen-lockfile`), versões fixadas, Node 24.                                |

## Regras de negócio

Nenhuma implementada. Todas documentadas em `docs/product/business-rules.md`.

## Critérios de aceitação (resumo)

- [x] CA-01 Liveness e readiness funcionam com dependências no ar.
- [x] CA-02 Readiness retorna 503 quando uma dependência falha.
- [x] CA-03 Erros seguem Problem Details com `requestId`.
- [x] CA-04 Configuração inválida impede o start.
- [x] CA-05 Página de status renderiza os três estados.
- [x] CA-06 `pnpm verify` passa; violação de boundary é detectada.
- [x] CA-07 Integração real com PostgreSQL e Redis (Testcontainers) passa.
- [x] CA-08 Arquivos de Claude Code válidos e sem referências quebradas.

## Casos limite

- `x-request-id` recebido com formato inválido ou muito longo → ignorado e substituído por UUID gerado.
- Dependência que não responde (sem erro) → considerada `down` após o timeout.
- Payload JSON acima do limite → 413 Problem Details.

## Restrições

ADR 0002 (versões), 0003 (arquitetura), 0010 (estilos).
