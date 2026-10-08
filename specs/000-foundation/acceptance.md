# 000 — Fundação do projeto · Aceitação

## Cenários

### CA-01 — Liveness e readiness com dependências no ar

```gherkin
Dado que PostgreSQL e Redis estão saudáveis
Quando consulto GET /health/live e GET /health/ready
Então ambos respondem 200
E readiness lista "postgres" e "redis" com status "up"
```

Testes: `apps/api/src/app.spec.ts` › health; verificação manual com `curl` contra a infraestrutura do Docker Compose.

### CA-02 — Readiness degradado

```gherkin
Dado que uma dependência falha ou excede o timeout
Quando consulto GET /health/ready
Então a resposta é 503 com status "not_ready"
E a dependência aparece com status "down"
E o corpo não contém mensagens de erro internas
```

Testes: `apps/api/src/health/check-readiness.spec.ts`, `apps/api/src/app.spec.ts`.

### CA-03 — Problem Details

```gherkin
Quando requisito uma rota inexistente
Então recebo 404 com Content-Type application/problem+json, code "ROUTE_NOT_FOUND" e requestId igual ao header x-request-id da resposta
```

Testes: `apps/api/src/app.spec.ts`.

### CA-04 — Configuração inválida

```gherkin
Dado DATABASE_URL ausente e API_PORT não numérica
Quando a API carrega a configuração
Então a inicialização falha listando DATABASE_URL e API_PORT, sem exibir valores
```

Testes: `apps/api/src/config/env.spec.ts`.

### CA-05 — Página de status

```gherkin
Quando abro a aplicação web
Então vejo "Status do sistema" e, após a verificação, o estado de cada dependência
E, se a API estiver fora do ar, vejo uma mensagem de indisponibilidade e a ação "Tentar novamente"
```

Testes: `apps/web/src/app/features/system-status/system-status.page.spec.ts`, `apps/web-e2e/src/system-status.spec.ts`.

### CA-06 — Qualidade e limites

```gherkin
Quando executo pnpm verify
Então lint, typecheck, testes e build passam
E uma importação proibida (ex.: contracts → backend) faz o lint falhar
```

Evidência: saída de `pnpm verify` e teste negativo temporário de boundary.

### CA-07 — Integração real

```gherkin
Dado Docker disponível
Quando executo pnpm test:integration
Então as probes de PostgreSQL e Redis reportam "up" contra containers reais e "down" contra endereços inválidos
```

### CA-08 — Claude Code

```gherkin
Quando valido .claude/
Então agentes e skills têm frontmatter YAML válido, hooks executam e bloqueiam os arquivos protegidos
E todas as referências a arquivos em CLAUDE.md, regras, agentes, skills e docs existem
```

## Definição de concluído

- [x] CA-01 a CA-08 comprovados com evidência em `tasks.md`
- [x] `pnpm verify` passando
- [x] Documentação de setup reproduzível
