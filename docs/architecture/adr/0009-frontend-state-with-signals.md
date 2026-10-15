# 0009 — Estado do frontend com Signals, sem NgRx Store

- **Status**: Aceito
- **Data**: 2026-10-08
- **Relacionados**: [.claude/rules/angular.md](../../../.claude/rules/angular.md)

## Contexto

O frontend precisa de estado local de telas, estado compartilhado limitado por feature (quadro Kanban, tarefa aberta, sessão) e integração com HTTP e WebSocket. Angular 22 é zoneless por padrão, o que favorece Signals.

## Alternativas consideradas

### A — NgRx Store (Redux)

- Prós: padrão consolidado, devtools.
- Contras: boilerplate alto; o brief proíbe sem necessidade comprovada.

### B — NgRx SignalStore

- Prós: estrutura e extensões.
- Contras: dependência adicional; útil, mas não necessária no MVP.

### C — Signals nativos + serviços de store por feature

- Prós: zero dependência; integra com `httpResource`, `toSignal`, zoneless.
- Contras: convenções precisam ser definidas pelo projeto.

## Decisão

Adotamos **C**: leitura reativa com `httpResource`; stores por feature como classes `@Injectable()` com signals privados expostos via `asReadonly()`/`computed` e métodos de comando; RxJS para streams (WebSocket, debounce, cancelamento). Atualizações otimistas guardam snapshot para rollback e reconciliam por `version`. Reavaliar SignalStore se surgirem ≥ 3 stores com lógica repetida de entidade/coleção.

## Consequências

- **Positivas**: menos código, alinhado ao Angular moderno.
- **Negativas**: sem devtools de time-travel.
- **Como verificar**: revisão de código; testes de store (comandos, rollback).
