# 0011 — Worker BullMQ e Transactional Outbox antecipados para e-mails transacionais

- **Status**: Aceito (2026-10-08, com a aprovação da spec 001) · Substitui parcialmente o [ADR 0008](0008-domain-events-and-outbox.md)
- **Nota**: escopo ampliado pelo [ADR 0017](0017-outbox-for-cross-context-integration-events.md) (Outbox também para eventos de integração entre contextos, a partir da spec 008); o restante continua valendo.
- **Data**: 2026-10-08
- **Relacionados**: [ADR 0008](0008-domain-events-and-outbox.md), [spec 001](../../../specs/001-authentication/design.md), [roadmap](../../product/roadmap.md)

## Contexto

A spec 001 exige e-mails de verificação e de recuperação de senha. O roadmap previa `apps/worker`, BullMQ e Outbox apenas na Fase 4, e o ADR 0008 deixava a Outbox como "quando justificado". Perder um e-mail de verificação bloqueia o onboarding (BR-013); perder um de recuperação impede o acesso à conta. O usuário decidiu (2026-10-08) antecipar a arquitetura assíncrona definitiva em vez de um envio síncrono provisório.

## Alternativas consideradas

### A — Envio SMTP síncrono na requisição

- Prós: simples, sem processo extra.
- Contras: latência e falhas do SMTP afetam a API; e-mail perdido se o SMTP falhar após o commit; timing diferente revela existência de conta (BR-014).

### B — Porta `EmailSender` com adapter síncrono agora, fila depois

- Prós: troca futura sem alterar casos de uso.
- Contras: mantém os problemas de A durante todo o MVP.

### C — Outbox + relay + BullMQ + worker já na Fase 1

- Prós: entrega pelo menos uma vez; API não depende do SMTP; respostas com tempo uniforme; arquitetura final desde o início.
- Contras: mais componentes (tabela, relay, fila, processo) e testes de integração com Redis.

## Decisão

Adotamos **C**, com escopo mínimo:

1. Casos de uso gravam eventos de integração em `outbox_events` **na mesma transação** (porta `OutboxWriter`).
2. `apps/worker` executa o `OutboxRelay` (polling a cada 1 s, `FOR UPDATE SKIP LOCKED`, lote de 50) que publica na fila BullMQ `emails` com `jobId = eventId`, e o consumidor dessa fila.
3. **Tokens de uso único são emitidos pelo consumidor**, não pelo caso de uso: a outbox carrega apenas `userId`, e nenhum token em texto puro é persistido. Idempotência por `user_tokens.source_event_id` (único).
4. Retry: 5 tentativas com backoff exponencial; falhas permanentes ficam no estado `failed` do BullMQ com log `error`.
5. Ambiente local usa Mailpit no Docker Compose como SMTP falso.
6. Casos de uso de envio (`SendEmailVerification`, `SendPasswordReset`, `SendAccountNotice`) vivem em `identity/application`; o worker apenas mapeia tipo de evento → caso de uso. Cada tentativa emite **novo** token (upsert por `source_event_id`), garantindo que retries após falha de SMTP ainda entreguem um link válido.
7. E-mails de segurança pertencem ao contexto `identity` e **não** seguem preferências de notificação; a spec 008 (Notifications) não os absorve. `SmtpEmailSender` é transporte genérico em `shared/infrastructure`.
8. Payloads de fila são tipados na `application` do contexto produtor; `libs/contracts` fica restrito a contratos HTTP/socket (camadas `application`/`infrastructure` não podem depender de `type:contracts`). Isso restringe o ADR 0008 quanto à localização de eventos de integração.
9. BullMQ com `removeOnComplete: { age: 86400 }` para que a deduplicação por `jobId` cubra republicações do relay; Redis em `noeviction`.

Isso **antecipa parcialmente** a Fase 4 (worker e outbox) e torna aceita, para e-mails transacionais, a Outbox que o ADR 0008 deixava como proposta. Métricas, OpenTelemetry e outras filas permanecem na Fase 4.

## Consequências

- **Positivas**: nenhum e-mail se perde por queda da API; tokens nunca persistidos em claro; base pronta para notificações (spec 008).
- **Negativas**: um processo a mais para rodar localmente (`pnpm dev` passa a subir o worker) e em produção; retries podem enviar um segundo e-mail com link novo (o anterior permanece válido até expirar).
- **Riscos**: acúmulo de eventos se o worker parar — mitigado por readiness do worker e pela limpeza de eventos publicados; verificação de atraso da outbox entra nas métricas da Fase 4.
- **Como verificar**: teste de integração (PostgreSQL + Redis reais) que grava evento com o worker parado, inicia o worker e confirma um único job e um único token por evento; E2E lendo o e-mail no Mailpit.
