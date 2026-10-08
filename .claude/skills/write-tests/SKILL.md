---
name: write-tests
description: Cria testes para o TaskFlow a partir das regras de negócio (BR-xxx) e critérios de aceitação de uma spec — escolhendo o nível certo (domínio, aplicação, integração com Testcontainers, HTTP com Supertest, componente Angular ou E2E Playwright). Use ao implementar uma tarefa, ao cobrir uma regra sem teste ou ao reproduzir um bug.
argument-hint: "<arquivo, BR-xxx ou spec>"
---

# Escrever testes

Alvo: $ARGUMENTS

Siga `.claude/rules/testing.md`.

## Passos

1. **Fonte de verdade**: leia o `acceptance.md` e as BRs envolvidas (`docs/product/business-rules.md`). Para bug, escreva primeiro o teste que reproduz a falha.
2. **Matriz**: para cada critério/BR, escolha o nível mais baixo que o comprova:
   - invariante/regra pura → teste de domínio;
   - orquestração, autorização, transação → teste de caso de uso com fakes;
   - query, constraint, isolamento, concorrência → integração (`*.integration.spec.ts`, Testcontainers);
   - status HTTP, validação, mapeamento de erro → Supertest;
   - estados de tela, formulários → teste de componente;
   - jornada crítica do usuário → Playwright.
3. **Casos obrigatórios** por tipo de mudança: sucesso, entrada inválida, estado proibido, sem permissão, cross-tenant, conflito de versão, idempotência (jobs/ações repetidas).
4. **Escreva** com nomes descritivos em inglês (`'BR-006: rejects completion while blocking dependencies are open'`), AAA, fakes em vez de mocks, `Clock` controlado.
5. **Execute** o projeto afetado (`pnpm nx run <projeto>:test`, `pnpm test:integration`) e confirme que o teste novo falharia sem a implementação quando for viável.
6. **Reporte** a matriz critério → teste, a saída real e lacunas restantes.
