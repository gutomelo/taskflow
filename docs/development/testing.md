# Estratégia de testes

Regras operacionais para agentes: [.claude/rules/testing.md](../../.claude/rules/testing.md). Este documento explica a estratégia.

## Pirâmide orientada a risco

```mermaid
flowchart TB
    e2e["E2E Playwright<br/>poucas jornadas críticas"]
    integ["Integração<br/>PostgreSQL/Redis reais (Testcontainers) · HTTP (Supertest)"]
    unit["Unitários<br/>domínio · casos de uso · componentes/estado Angular"]
    e2e --- integ --- unit
```

A maior parte do valor está em **testes de domínio e de caso de uso** (rápidos, determinísticos) e em **testes de integração** dos riscos que só aparecem com banco real (isolamento entre tenants, constraints, concorrência, transações).

## Riscos prioritários e como são cobertos

| Risco                            | Teste                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| Vazamento entre organizações     | Integração por endpoint/repositório com duas organizações semeadas.                   |
| RBAC incorreto                   | Tabela-driven a partir da matriz em [authorization.md](../security/authorization.md). |
| Rotação/reuso de refresh token   | Integração: rotação, reuso → revogação da família, expiração, logout.                 |
| Conclusão de tarefa (BR-001/006) | Domínio (regra) + integração (mesma transação).                                       |
| Movimentação Kanban (BR-004/009) | Domínio (transições, ranking) + integração (movimentos concorrentes).                 |
| Conflitos concorrentes (BR-008)  | Integração: duas escritas na mesma versão → uma 409.                                  |
| Atomicidade (BR-010)             | Integração: falha forçada após primeira escrita não deixa estado parcial.             |
| Idempotência de jobs             | Consumidor processando o mesmo evento duas vezes produz um único efeito.              |

## Organização

- Unitários: `*.spec.ts` ao lado do código, target `test` de cada projeto (Vitest; Angular via `@angular/build:unit-test`).
- Integração: `*.integration.spec.ts`, target `integration-test` com `vitest.integration.config.mts`; containers sobem uma vez por arquivo de teste.
- E2E: `apps/web-e2e`, target `e2e` (Playwright sobe API, worker e web; requer `pnpm infra:up`, que inclui o Mailpit).

### E2E: banco descartável

A jornada `auth-journey.spec.ts` (CA-14) não simula nada: cadastra um usuário de verdade, o worker envia o e-mail ao Mailpit e o teste segue o link. **Não rode contra o banco de desenvolvimento.** No CI o banco do serviço é efêmero; localmente, use um banco e um índice do Redis só para o E2E:

```bash
pnpm infra:up
docker compose exec postgres createdb -U taskflow taskflow_e2e        # uma vez
DATABASE_URL=postgresql://taskflow:taskflow@localhost:55432/taskflow_e2e pnpm db:deploy

DATABASE_URL=postgresql://taskflow:taskflow@localhost:55432/taskflow_e2e \
REDIS_URL=redis://localhost:56379/2 \
pnpm e2e
```

As variáveis do shell têm precedência sobre o `.env` (o Nx não as sobrescreve). O Playwright lê o Mailpit em `MAILPIT_URL` (padrão `http://localhost:58025`). Os demais testes E2E simulam a API com `page.route` e não gravam dados. O cadastro é limitado a 5 por hora por IP: várias execuções seguidas da jornada podem receber 429; os contadores ficam no índice do Redis usado pelo E2E (`rate-limit:*`) e expiram sozinhos.

As jornadas `organizations-journey.spec.ts` (spec 002, CA-11) e `projects-journey.spec.ts` (spec 003, CA-10) também são reais: cadastram duas contas cada, criam uma organização e convidam pelo Mailpit; a de projetos cria um projeto, adiciona o participante, arquiva, restaura e segue com as tarefas da spec 004 (criar, atribuir, subtarefa obrigatória, conclusão recusada e concluída) o quadro da spec 005 (coluna nova, transições, movimentos por teclado, conclusão recusada no quadro) e os comentários da spec 010 (menção pelo teclado, edição, moderação, tarefa cancelada só com excluir) com as mesmas contas. Os passos de conta e convite ficam em `apps/web-e2e/src/support/accounts.ts`. Uma execução completa faz **cinco cadastros** — exatamente o limite de cadastro por IP —, então uma segunda execução seguida recebe 429. Para repetir sem esperar a expiração, apague **só** as chaves de limite de autenticação do índice do E2E (nunca do índice de desenvolvimento):

```bash
docker compose exec redis sh -c "redis-cli -n 2 --scan --pattern 'rate-limit:auth.*' | xargs -r redis-cli -n 2 del"
```

Testes que simulam o login (`page.route`) também precisam simular `GET /api/v1/me/organizations` (helper `support/organizations.ts`): o seletor de organização do cabeçalho chama a API real, e uma sessão inexistente nela encerraria a sessão simulada.

Se o `.env` local definir `PORT`, o executor de Node do Nx o usa como porta do inspector e ela colide com a API (`Port 3333 is already in use`). Use `NX_LOAD_DOT_ENV_FILES=false` com as variáveis exportadas, ou remova `PORT` do `.env` (a API usa `API_PORT`).

## Metas de cobertura

- **90%** de linhas em `domain` e `application` de contextos críticos (identity, organizations, projects, tasks, boards).
- **80%** global de lógica testável como objetivo evolutivo.
- Cobertura é indicador, não objetivo: revisões rejeitam testes sem asserções significativas.

```bash
pnpm nx run <projeto>:test --coverage
```

Os limites (`thresholds`) serão ativados por biblioteca quando cada contexto crítico for criado, para não bloquear a fundação com metas sem código.

## Estado atual

Spec 001: unitários de domínio, aplicação, HTTP e frontend; integração com PostgreSQL, Redis e Mailpit (Testcontainers), inclusive o pipeline de e-mail do worker; E2E com jornadas simuladas e a jornada real CA-14. Evidências em `specs/001-authentication/tasks.md`.

Spec 002: domínio com política de papéis tabela-driven; casos de uso com fakes; integração com PostgreSQL para repositórios, concorrência (lock da organização, rebaixamento mútuo, aceite × revogação) e **isolamento A/B pela API real** (`apps/api`, alvo `integration-test`); Mailpit para convites; componentes Angular com rotas reais; E2E da jornada real CA-11. Mutation testing manual registrado por tarefa. Evidências em `specs/002-organizations/tasks.md`.

Spec 006: matrizes do kernel transcritas do documento (tabela-driven, chaves hostis) e paridade de catálogo kernel × contracts; **harness de isolamento** em `apps/api/src/testing` — varredura da tabela de rotas real (`route-coverage.spec.ts`, unitário) e casos gerados por rota com snapshot de todas as tabelas com `organization_id` e ids canário (`organizations-isolation.integration.spec.ts`). Toda rota tenant-scoped nova precisa de caso em `isolation-cases.ts`. Evidências em `specs/006-permissions/tasks.md`.

Spec 003: domínio e casos de uso de `projects` com fakes (BR-025…BR-027, ordem de decisão, D1); integração dos repositórios e das restrições do banco (CHECKs, FKs compostas e do ADR 0015, cascatas); **composição real com concorrência** (`projects-composition.integration.spec.ts`: rebaixamento × promoção nas duas ordens, configuração × criação, lock de outra conexão, BR-008); harness de isolamento ampliado e **bateria de autorização dentro da organização** (`projects-authorization.integration.spec.ts`); componentes Angular da lista, criação e área do projeto; jornada E2E real `projects-journey.spec.ts`. `apps/api/src/testing/integration-api.ts` monta a API real para os testes de integração. Evidências em `specs/003-projects/tasks.md`.

### Fase 0

Spec 004: domínio de `tasks` (BR-001, BR-004, BR-006 com D4, BR-028, BR-029, ações) e casos de uso com fakes (`createTasksWorld`: ordem de decisão, D1–D5, limites, núcleo × casca); integração dos repositórios, do catálogo da FK `SET NULL ("assignee_user_id")` e do runner (READ COMMITTED, repetição em deadlock); **composição real com concorrência** (`tasks-composition.integration.spec.ts`: numeração simultânea, ciclo em paralelo, pai × subtarefa obrigatória, atribuição × rebaixamento, arquivar × criar, revogação × transição, todos os caminhos de RF-11) com o **verificador do invariante BR-003** depois de cada teste; harness de isolamento e bateria `tasks-authorization.integration.spec.ts`; componentes Angular da aba de tarefas e do detalhe; o passo "spec 004" da jornada E2E `projects-journey.spec.ts`. Evidências em `specs/004-tasks/tasks.md`.

Spec 010: texto e menções com mutation testing (domínio); casos de uso com fakes (ordens de decisão, 404 único por comentário, menções novas, moderação, só leitura); integração do catálogo e das cascatas, do repositório e da **composição concorrente** (`comments-composition.integration.spec.ts`: comentar × cancelar nos dois sentidos, × excluir tarefa, × remover o mencionado); harness com referências em texto (`embeddedReferences`) e bateria `comments-authorization`; componentes da conversa e do composer com menções pelo teclado, segmentação com cargas de XSS e bidi; o passo "spec 010" da jornada E2E. Evidências em `specs/010-comments/tasks.md`.

Spec 008: domínio (destinatários sem o ator, chaves de deduplicação, 404 único) e casos de uso com fakes (registro com teto e FK, lista com páginas curtas e falha fechado, contador, `read-all` com `upToId`, resumo e retenção); integração do schema (índices parciais, CHECK, cascatas) e dos repositórios; produtores gravando na Outbox com rollback (BR-010); consumidor do worker com schemas e anticorrupção (valores hostis, `UnrecoverableError`); **pipeline real no worker** (`notification-delivery.integration.spec.ts`: PostgreSQL, Redis e Mailpit — worker parado e voltando, idempotência, FK de quem saiu, resumo sem nomes nem conteúdo, retenção); isolamento entre organizações e **entre usuários da mesma organização** (`notifications-isolation.integration.spec.ts`); componentes do sino (polling e visibilidade com timers falsos), da página e da preferência; passo E2E na jornada de projetos (o teste dispara o planejamento do resumo na fila, como o agendador horário). Mutation testing manual em todas as tarefas.

Spec 005: chave de posição com testes de propriedade (ordem, determinismo, crescimento, rebalanceamento); workflow editável (BR-030) no domínio; casos de uso do quadro e do workflow com fakes; integração da migration (collation `"C"`, índice `lower(name)`, CHECK, ordenação ASCII), dos repositórios (coluna, vizinhos, rebalanceamento, reatribuição) e da **composição concorrente** (`board-composition.integration.spec.ts`: mesmo ponto, empate, rebalanceamento × criação, remoção de coluna × movimento, transições × movimento, categoria × criação, cascata da organização); harness com listas e aninhados e baterias de quadro e workflow; componentes do quadro (arrastar e teclado) e da configuração do fluxo; passo "spec 005" da jornada E2E. Evidências em `specs/005-kanban/tasks.md`.

Implementado e executado: unitários de contratos, configuração e health da API (Supertest), componente de status do web, integração das probes de PostgreSQL/Redis com Testcontainers e um E2E de fumaça. Resultados na seção de validação de `specs/000-foundation/tasks.md`.
