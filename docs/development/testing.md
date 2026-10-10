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

A jornada `organizations-journey.spec.ts` (spec 002, CA-11) também é real: cadastra duas contas, cria uma organização, convida pelo Mailpit, aceita, troca o papel e sai. Uma execução completa faz três cadastros ou mais, então duas execuções seguidas esgotam o limite de cadastro por IP. Para repetir sem esperar a expiração, apague **só** as chaves de limite de autenticação do índice do E2E (nunca do índice de desenvolvimento):

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

### Fase 0

Implementado e executado: unitários de contratos, configuração e health da API (Supertest), componente de status do web, integração das probes de PostgreSQL/Redis com Testcontainers e um E2E de fumaça. Resultados na seção de validação de `specs/000-foundation/tasks.md`.
