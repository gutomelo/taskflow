---
paths:
  - "**/*.spec.ts"
  - "**/*.test.ts"
  - "**/*.integration.spec.ts"
  - "**/vitest*.config.mts"
  - "apps/web-e2e/**"
---

# Regras de testes

Referência: `docs/development/testing.md`.

## Estratégia orientada a risco

| Camada | Tipo | Ferramenta | Arquivo |
| --- | --- | --- | --- |
| Domain | unitário puro, sem mocks de infraestrutura | Vitest | `*.spec.ts` ao lado do código |
| Application | unitário com fakes em memória das portas | Vitest | `*.spec.ts` |
| HTTP | contrato/controller com app real e fakes | Vitest + Supertest | `*.spec.ts` |
| Infrastructure | integração com PostgreSQL/Redis reais | Vitest + Testcontainers | `*.integration.spec.ts` |
| Frontend | componente/estado/formulário | Vitest (`@angular/build:unit-test`) | `*.spec.ts` |
| Jornada | E2E | Playwright | `apps/web-e2e/src/*.spec.ts` |

## Regras

- Cada regra de negócio (BR-xxx) tem teste nomeado com seu ID: `it('BR-001: rejects completion while mandatory subtasks are pending')`.
- Cada feature tenant-scoped tem teste de isolamento entre organizações; cada endpoint protegido tem teste 401/403/404.
- Concorrência (BR-008/009): teste de integração com duas atualizações na mesma versão → uma 409.
- Prefira **fakes** (implementações em memória das portas) a mocks de chamadas. Mock apenas para verificar interação essencial (ex.: evento publicado).
- Arrange/Act/Assert claros; um comportamento por teste; nomes em inglês descrevendo comportamento.
- Sem dependência de ordem, relógio real ou rede externa; use `Clock` falso e dados criados no próprio teste.
- Testes de integração isolam dados (schema/banco efêmero via Testcontainers) e limpam o que criam.
- Nunca relaxe uma asserção ou marque `skip` para "fazer passar". Teste quebrado = bug ou spec errada; investigue.
- Cobertura: meta 90% linhas em domain/application críticos, 80% global como objetivo evolutivo. Não escreva testes artificiais para atingir número.
- Nunca declare testes como executados sem rodá-los; cole o resumo da saída ao reportar.
