# 0008 — Domain events despachados após commit; Transactional Outbox quando justificado

- **Status**: Aceito (despacho pós-commit) · Outbox: **Proposto** para a Fase 4
- **Data**: 2026-10-08
- **Relacionados**: BR-007, BR-010, [data-flow](../data-flow.md)

## Contexto

Casos de uso geram efeitos secundários (notificações, socket, e-mail, analytics). Publicá-los antes do commit pode anunciar mudanças que sofreram rollback; publicá-los depois do commit pode perdê-los se o processo cair entre commit e publicação.

## Alternativas consideradas

### A — Publicar dentro da transação

- Contras: efeitos externos de transações revertidas. Rejeitada.

### B — Despacho in-process após commit

- Prós: simples; suficiente para efeitos tolerantes a perda rara (socket, invalidação de cache).
- Contras: perda possível em crash entre commit e despacho.

### C — Transactional Outbox

- Prós: evento persistido na mesma transação; entrega pelo menos uma vez.
- Contras: tabela extra, relay, consumidores idempotentes, monitoramento.

## Decisão

- Entidades registram eventos de domínio (`TaskCompleted`, `TaskAssigned`, `SprintStarted`, `ProjectMemberAdded`…); o caso de uso os coleta e um `EventDispatcher` in-process os despacha **após o commit** (B).
- Auditoria (BR-007) **não** é evento assíncrono: é gravada na mesma transação.
- Eventos de domínio (internos, ricos) são distintos de **eventos de integração** (contratos estáveis em `libs/contracts`, versionados, usados por socket/filas).
- Quando surgir efeito que não pode ser perdido (e-mail de convite/recuperação, notificações persistidas por fila), a spec correspondente adota **Outbox (C)**: tabela `outbox_events` na mesma transação, relay publicando no BullMQ, consumidores idempotentes por `eventId`, retry com backoff e fila de falhas.
- Event Sourcing está fora do escopo.

## Consequências

- **Positivas**: nenhum efeito de transação revertida; caminho evolutivo claro.
- **Negativas**: até a Outbox, efeitos em tempo real podem raramente se perder — aceitável porque o estado persistido é a fonte da verdade e clientes reconciliam ao recarregar.
- **Como verificar**: testes de caso de uso confirmam que eventos não são despachados em falha; testes de consumidor confirmam idempotência.
