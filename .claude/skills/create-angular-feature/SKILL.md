---
name: create-angular-feature
description: Padroniza a criação de uma feature Angular no TaskFlow — rota lazy, componentes standalone, estado com Signals, acesso HTTP tipado por contratos, estados de loading/vazio/erro, responsividade, acessibilidade e testes. Use ao implementar telas previstas em uma spec aprovada.
argument-hint: '<nome-da-feature> [spec]'
---

# Criar feature Angular

Feature: $ARGUMENTS

Siga `.claude/rules/angular.md` e `docs/design-system.md`.

## Planejamento

- Telas, rotas e estados (loading, vazio, erro, sucesso, sem permissão, conflito) a partir do `requirements.md`/`design.md`.
- Contratos consumidos (`@taskflow/contracts`) — se não existirem, pare: o contrato nasce no backend/spec.
- Local: `apps/web/src/app/features/<feature>/` (fase atual) ou biblioteca `libs/frontend/<domain>/*` se já existir/for reutilizada.

## Estrutura sugerida

```
features/<feature>/
├── <feature>.routes.ts          # rotas lazy da feature
├── data-access/<feature>.api.ts # HttpClient/httpResource tipados por contratos
├── data-access/<feature>.store.ts  # (se houver estado compartilhado) signals + comandos
├── pages/<page>.page.ts         # smart: orquestra store e UI
└── ui/<component>.ts            # dumb: input()/output(), sem HttpClient
```

Crie apenas o que a feature precisa.

## Passos

1. Registrar rota lazy em `app.routes.ts` (`loadChildren`/`loadComponent`) com guard quando autenticada.
2. Data access: leitura com `httpResource`; mutação com `HttpClient` + atualização do estado; erros mapeados de `ProblemDetails` para mensagens pt-BR.
3. Página: `OnPush`, signals/computed, control flow com `track`, skeleton/empty/error states.
4. UI: componentes Material/CDK quando houver comportamento complexo; layout com Tailwind; cores por token.
5. Formulários: Reactive Forms tipados, mensagens de validação acessíveis, botão de envio com estado de carregamento.
6. Acessibilidade: rótulos, foco após navegação/erro, teclado, `aria-live`.
7. Testes: página (render dos estados com `HttpTestingController`), store (comandos e rollback), formulário (validação). E2E se for jornada crítica.
8. Verificar: `pnpm nx run web:lint`, `pnpm nx run web:test`, `pnpm nx run web:build`.
