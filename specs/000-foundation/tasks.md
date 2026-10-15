# 000 — Fundação do projeto · Tarefas

| ID  | Tarefa                                                                                                           | Depende de | Verificação                                 | Status |
| --- | ---------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------- | ------ |
| T1  | Verificar versões e compatibilidade; registrar no ADR 0002                                                       | —          | ADR 0002                                    | [x]    |
| T2  | Context engineering: CLAUDE.md, regras, agentes, skills, hooks, permissões                                       | T1         | CA-08                                       | [x]    |
| T3  | Documentação de arquitetura, segurança, produto, Design System, ADRs, SDD                                        | T1         | Verificação de links                        | [x]    |
| T4  | Workspace Nx: apps `web`, `api`, `web-e2e`; libs `contracts`, `backend-shared-infrastructure`; tags e boundaries | T1         | `pnpm lint` + teste negativo de boundary    | [x]    |
| T5  | Prisma 7: schema, `prisma.config.ts`, geração do client na lib de infraestrutura                                 | T4         | `pnpm db:generate`                          | [x]    |
| T6  | Docker Compose (PostgreSQL, Redis) e `.env.example`                                                              | —          | `pnpm infra:up` + `pnpm infra:ps` healthy   | [x]    |
| T7  | Contratos de health e Problem Details                                                                            | T4         | testes de `contracts`                       | [x]    |
| T8  | Infraestrutura: clientes Prisma/Redis e probes; integração com Testcontainers                                    | T5, T7     | `pnpm test:integration`                     | [x]    |
| T9  | API: config, logger, request id, erros, health, composition root, shutdown                                       | T7, T8     | testes `api` + `curl`                       | [x]    |
| T10 | Web: tokens, tema, Tailwind, shell, página de status, proxy                                                      | T7         | testes `web` + build                        | [x]    |
| T11 | E2E de fumaça                                                                                                    | T9, T10    | `pnpm e2e`                                  | [x]    |
| T12 | Scripts raiz, CI, Dependabot, Dockerfiles                                                                        | T9, T10    | `pnpm verify`; build e execução das imagens | [x]    |
| T13 | Validação final e relatório                                                                                      | todas      | CA-01…CA-08                                 | [x]    |

## Evidências (2026-10-08, Node 24.21, pnpm 11.11, Docker 29.1)

| Critério | Evidência                                                                                                                                                        | Resultado                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| CA-01    | `curl /health/live` e `/health/ready` contra a API real + PostgreSQL 18/Redis 8 do Compose                                                                       | 200 `{status:"ok"}`; 200 `ready` com latências                                            |
| CA-02    | `docker compose stop redis` + `curl /health/ready`; testes `check-readiness.spec.ts` e `app.spec.ts`                                                             | 503 `not_ready`, `redis: down`, sem mensagem interna; volta a 200 ao religar              |
| CA-03    | `curl -H 'x-request-id: e2e-check-1' /api/v1/nope`; `app.spec.ts`                                                                                                | 404 `application/problem+json`, `ROUTE_NOT_FOUND`, `requestId` ecoado                     |
| CA-04    | `env.spec.ts`                                                                                                                                                    | Lista `API_PORT`, `DATABASE_URL`, `REDIS_URL`; nenhum valor exposto                       |
| CA-05    | `system-status.page.spec.ts` (4 testes) e E2E                                                                                                                    | Estados carregando/pronto/degradado/indisponível + retry                                  |
| CA-06    | `pnpm verify --skip-nx-cache`; violações temporárias (`contracts → backend`, `contracts → express`, `web → backend`)                                             | verify ok em 5 projetos; as 3 violações falham o lint e foram removidas                   |
| CA-07    | `pnpm test:integration --skip-nx-cache`                                                                                                                          | 5/5 (inclui regressão de concorrência na probe Redis, confirmada falhando sem a correção) |
| CA-08    | Validação de frontmatter (9 agentes, 10 skills, 10 regras), `settings.json`, hooks executados com entradas de teste, verificação de referências em 68 documentos | Sem erros; referências restantes são caminhos planejados e sinalizados                    |
| Extra    | `pnpm e2e` (Playwright/Chromium, API + web reais)                                                                                                                | 2/2                                                                                       |
| Extra    | `docker compose --profile app up --build --wait`                                                                                                                 | migrate ok, API healthy (usuário `node`), Nginx servindo SPA + proxy                      |
| Extra    | `pnpm format:check`; `prisma migrate status`                                                                                                                     | ok; banco acessível, sem migrations                                                       |

Totais de testes: contracts 2 · api 17 · web 4 · integração 5 · E2E 2 = **30 testes, todos passando**.

## Problemas encontrados e corrigidos durante a validação

1. **`PORT` no `.env` sequestrava o dev server do Angular** (o Nx injeta o `.env` em todas as tarefas) → API passou a usar `API_PORT`/`API_HOST`; `web:serve` com `port: 4200` explícito.
2. **Condição de corrida na probe do Redis** com verificações simultâneas durante a conexão inicial → espera cancelável pelo evento `ready` com `AbortSignal`; teste de regressão.
3. **Shutdown falhava se o Redis nunca conectou** (`quit()` sem conexão) → `disconnect()` nesse caso.
4. **`@prisma/client` ausente do `package.json` gerado** (Nx ignora arquivos do `.gitignore`) → `.nxignore` reinclui o client gerado.
5. Portas padrão 5432/6379 ocupadas por serviços nativos → Compose usa 55432/56379.
