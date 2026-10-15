---
paths:
  - 'apps/web/**'
  - 'apps/web-e2e/**'
  - 'libs/frontend/**'
---

# Regras de Angular

Referências: `docs/architecture/overview.md#frontend`, `docs/design-system.md`, ADR 0009.

## Estrutura

- Fase atual: features vivem em `apps/web/src/app/features/<feature>/`; infraestrutura transversal em `apps/web/src/app/core/`.
- Quando uma feature crescer ou for reutilizada, extraia para `libs/frontend/<domain>/{feature,ui,data-access,util,model}` com tags `scope:frontend`, `domain:<x>`, `type:<x>`.
  - `feature`: páginas e orquestração (smart components). Pode usar `ui`, `data-access`, `util`, `model`.
  - `ui`: componentes de apresentação puros (inputs/outputs), sem HttpClient nem estado global.
  - `data-access`: clientes HTTP, stores com Signals, integração com Socket.IO.
- Rotas sempre lazy (`loadComponent` / `loadChildren`). Um arquivo `<feature>.routes.ts` por feature.

## Componentes

- Standalone (padrão), `ChangeDetectionStrategy.OnPush`, app **zoneless** — estado que afeta a view deve ser Signal.
- APIs modernas: `input()`, `output()`, `model()`, `viewChild()`, `inject()`; control flow `@if/@for/@switch` com `track` obrigatório.
- Componentes pequenos e com uma responsabilidade; templates acima de ~120 linhas indicam extração.
- Prefixo de seletor `tf-`. Arquivos: `task-card.component.ts` ou `task-card.ts` seguindo o padrão já existente na pasta.
- Todo fluxo assíncrono exibe estados de **loading (skeleton), vazio, erro e sucesso**.

## Estado e RxJS

- Signals/computed para estado síncrono; `httpResource`/`resource` para leitura reativa; `HttpClient` direto para mutações.
- RxJS para streams (debounce de busca, WebSocket, cancelamento). Converta com `toSignal`/`toObservable` nas bordas.
- Nada de `subscribe` manual sem `takeUntilDestroyed()`; prefira não assinar.
- Store por feature: classe `@Injectable()` com signals privados e `readonly` públicos (`asReadonly()`), métodos de comando explícitos. **Sem NgRx Store** sem ADR.
- Atualização otimista apenas com rollback + reconciliação com a resposta do servidor/evento em tempo real.

## Formulários e acessibilidade

- Reactive Forms tipados (`FormBuilder.nonNullable`). Validação espelha o backend, mas o backend é a fonte da verdade.
- Meta WCAG 2.2 AA: rótulos associados, foco visível, navegação por teclado (inclusive drag-and-drop do CDK com alternativa por teclado), contraste dos tokens do Design System, `aria-live` para feedback assíncrono.
- Texto de UI em pt-BR, centralizado para i18n futuro (não espalhe strings em lógica TS).

## Estilo

- Tailwind para layout/espaçamento; Angular Material/CDK para componentes com comportamento complexo. Cores **somente via tokens** (`--tf-*` / classes Tailwind mapeadas) — nunca hex literal em componente.
- Não sobrescreva classes internas `.mat-mdc-*`; use `mat.*-overrides` no tema.

## Segurança

- Tokens de acesso nunca em `localStorage`/`sessionStorage`; autenticação por cookie HttpOnly (ver `docs/security/authentication.md`).
- Nunca use `bypassSecurityTrust*` sem revisão de segurança.
- Guards melhoram UX, mas **não** são controle de acesso — o backend sempre valida.

## Testes

- Vitest via `@angular/build:unit-test`. Testar comportamento observável (DOM, saídas, chamadas HTTP com `HttpTestingController`), não detalhes internos.
- E2E Playwright em `apps/web-e2e` para jornadas críticas; seletores por role/label acessível.
