# 0017 — Outbox para eventos de integração entre contextos (notificações)

- **Status**: Proposto
- **Data**: 2026-10-15
- **Decisores**: usuário (product owner); arquitetura (Claude Code, revisão da spec 008)
- **Relacionados**: [ADR 0008](0008-domain-events-and-outbox.md), [ADR 0011](0011-early-worker-and-outbox-for-email.md) (escopo ampliado), [ADR 0015](0015-cross-context-referential-integrity.md), [spec 008](../../../specs/008-notifications/design.md), [spec 010](../../../specs/010-comments/design.md) (obrigações para a 008)

## Contexto

O ADR 0011 adotou Outbox, relay e BullMQ só para e-mails transacionais e deixou "outras filas" para a Fase 4. A spec 008 precisa que menções (`collaboration`) e atribuições (`tasks`) virem notificações persistidas sem perda (BR-010, RF-03), e a spec 010 já exigiu a Outbox como obrigação 1. Hoje `tasks` e `collaboration` só registram eventos no log, depois do commit (`runTaskMutation`, `runCommentMutation`). Sem regra comum, cada spec decidiria sozinha onde gravar o evento, como nomeá-lo, onde fica o schema e como o consumidor valida.

## Alternativas consideradas

### A — Despacho in-process depois do commit (ADR 0008, B)

- Prós: sem fila nova; simples.
- Contras: perde notificação se o processo cair entre o commit e o despacho; o registro aconteceria na API, não no worker.

### B — Outbox com fila por finalidade e consumidor no worker

- Prós: entrega pelo menos uma vez; reaproveita `OutboxWriter`, `OutboxRelay` e `BullMqEventPublisher`; produtores não conhecem consumidores.
- Contras: mais um consumidor e uma fila; convenções a manter; o worker passa a compor consultas de mais contextos.

### C — Event bus genérico com assinaturas por contexto

- Prós: extensível.
- Contras: abstração especulativa sem segundo consumidor; contraria a regra contra excesso de engenharia.

## Decisão

Adotamos **B**:

1. Casos de uso de qualquer contexto podem gravar **eventos de integração** em `outbox_events` pela `OutboxWriter`, dentro do `TransactionRunner.run` da casca: depois do núcleo `…WithinTransaction` e antes do commit, por uma função pura do produtor que traduz os eventos internos. Núcleos chamados na transação de outro contexto fazem o mesmo.
2. **Nome**: `<contexto>.<fato_no_passado>` (snake_case), sem sufixo de versão; a evolução é aditiva (campos opcionais). Mudança incompatível cria um tipo novo e mantém o antigo até o consumidor migrar. Tipos de integração não reutilizam o nome de um evento de log com outro formato.
3. **Payload**: só ids e dados não sensíveis, tipado na `application` do produtor (constante `as const` de tipos e um `type` por payload), como no ADR 0011, item 8. `libs/contracts` continua restrito a HTTP e socket.
4. **Consumidor**: no composition root do worker, um schema Zod por tipo, declarado `satisfies z.ZodType<Payload do produtor>`; job inválido gera `UnrecoverableError`. O processador traduz o payload para um comando da `application` do contexto consumidor (camada anticorrupção no composition root); a `application` consumidora nunca importa tipos do produtor.
5. **Roteamento**: um único `OutboxRelay` por processo, com `BullMqEventPublisher` roteando tipo → fila (`emails`, `notifications`); `jobId = eventId` e as opções de retry e retenção do ADR 0011 (itens 4 e 9).
6. **Idempotência**: por chave natural no consumidor (por exemplo, `UNIQUE (organization_id, recipient_user_id, dedupe_key)` com `ON CONFLICT DO NOTHING`) e tratamento explícito de violação de FK como descarte.
7. Os eventos de log depois do commit continuam existindo; a Outbox não os substitui.

Este ADR amplia o escopo do ADR 0011 (a Outbox deixa de ser exclusiva de e-mails transacionais); o restante do 0011 continua valendo. Métricas e OpenTelemetry continuam na Fase 4.

## Consequências

- **Positivas**: notificações não se perdem; uma única convenção para as próximas filas (analytics, socket); produtores desacoplados dos consumidores.
- **Negativas / custos**: o worker passa a compor adaptadores de leitura de `organizations`, `projects`, `tasks`, `collaboration` e `identity` (duplicando trechos pequenos da API, cobertos por teste de composição); payload com duas definições (tipo TS e schema Zod), presas por `satisfies`.
- **Riscos e mitigação**:

  | Risco                                     | Mitigação                                                                                      |
  | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
  | Schema do consumidor divergir do produtor | `satisfies z.ZodType<Payload>` quebra o typecheck                                              |
  | Evento novo sem consumidor implantado     | O relay só lê tipos roteáveis; o evento espera na Outbox                                       |
  | Acúmulo depois de o worker ficar parado   | Readiness; consumidores usam `occurredAt` (não a hora do processamento) em janelas e ordenação |
  | Evento gravado fora da transação          | `OutboxWriter` falha sem transação ativa; teste de rollback no produtor                        |

- **Como verificar**: teste de integração com o worker parado, depois iniciado, conferindo uma notificação por fato; testes de rollback nas cascas de `tasks` e `collaboration` (sem evento); typecheck dos schemas com `satisfies`; lint de boundaries (`notifications/application` sem importações de `tasks` ou `collaboration`).

## Referências

- ADR 0008, ADR 0011 (itens 2, 4, 8 e 9), spec 010 ("Obrigações para a spec 008"), spec 008 (design)
- `libs/backend/shared/infrastructure/src/lib/events/outbox-relay.ts`, `bullmq-event-publisher.ts`
- `apps/worker/src/queues/email-jobs.ts` (precedente de validação por tipo)
