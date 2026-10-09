# Fluxos de dados

Estado: o fluxo de requisição e o health check estão **implementados** (Fase 0). Os demais fluxos são **planejados** e servem de referência para as specs.

## 1. Requisição HTTP padrão

```mermaid
sequenceDiagram
    autonumber
    participant C as Cliente (Angular)
    participant MW as Middlewares<br/>(requestId, helmet, auth*, tenant*, rate limit*)
    participant CT as Controller
    participant UC as Use Case
    participant D as Domain
    participant R as Repositório (porta)
    participant P as Adapter Prisma
    participant DB as PostgreSQL

    C->>MW: HTTP request
    MW->>CT: req + RequestContext (userId, organizationId verificados)
    CT->>CT: valida entrada (Zod)
    CT->>UC: execute(context, command)
    UC->>R: carrega agregado (organizationId, id)
    R->>P: implementação
    P->>DB: SELECT ... WHERE organization_id = $1 AND id = $2
    DB-->>P: linha
    P-->>UC: entidade de domínio
    UC->>D: comportamento (ex.: task.complete())
    D-->>UC: estado novo ou DomainError
    UC->>R: salva (transação, version)
    UC-->>CT: resultado de aplicação
    CT-->>C: contrato de resposta (JSON) ou ProblemDetails
```

`*` planejado na spec 001/006. Entidades de persistência nunca saem do adapter; o controller mapeia o resultado para o contrato de `@taskflow/contracts`.

## 2. Conclusão de tarefa (BR-001, BR-006, BR-007, BR-008, BR-010)

```mermaid
sequenceDiagram
    autonumber
    participant UI as Angular
    participant API as POST /api/v1/tasks/:id/complete
    participant UC as CompleteTaskUseCase
    participant AZ as TaskAccessPolicy
    participant TX as TransactionRunner
    participant T as Task (domínio)
    participant REPO as TaskRepository
    participant AUD as AuditLog
    participant EV as EventDispatcher

    UI->>API: { version }
    API->>UC: execute(ctx, { taskId, version })
    UC->>AZ: assertCanUpdate(ctx, taskId)
    alt sem acesso / outro tenant
        AZ-->>API: NotFound (404) ou Forbidden (403)
    end
    UC->>TX: run(tx)
    TX->>REPO: findWithSubtasksAndBlockers(orgId, taskId)
    REPO-->>T: restore(...)
    UC->>T: complete(clock)
    alt subtarefa obrigatória pendente / bloqueada
        T-->>API: 422 TASK_HAS_PENDING_REQUIRED_SUBTASKS / TASK_BLOCKED_BY_DEPENDENCIES
    end
    TX->>REPO: save(task, expectedVersion)
    alt version mudou
        REPO-->>API: 409 VERSION_CONFLICT (rollback)
    end
    TX->>AUD: record(task.completed) na mesma transação
    TX-->>UC: commit
    UC->>EV: dispatch(TaskCompleted) após commit
    API-->>UI: 200 { task, version+1 }
```

## 3. Sincronização Kanban (BR-004, BR-009)

```mermaid
sequenceDiagram
    autonumber
    participant A as Usuário A (Angular)
    participant B as Usuário B (Angular)
    participant API as POST /api/v1/boards/:id/moves
    participant UC as MoveCardUseCase
    participant DB as PostgreSQL
    participant IO as Socket.IO (room project:{id})

    A->>A: move otimista (guarda estado anterior)
    A->>API: { taskId, toColumnId, afterTaskId, version }
    API->>UC: execute
    UC->>UC: valida transição (BR-004) e regras de conclusão se coluna "done"
    UC->>DB: tx: atualiza status da tarefa + rank do card (version)
    alt conflito / transição inválida
        API-->>A: 409/422
        A->>A: rollback + recarrega coluna
    else sucesso
        API-->>A: 200 { rank, version }
        UC->>IO: após commit: card.moved { taskId, columnId, rank, version }
        IO-->>B: card.moved
        B->>B: reconcilia (aplica se version > local)
        IO-->>A: card.moved (ignorado: já aplicado)
    end
```

Clientes nunca alteram estado via socket; o socket apenas distribui o resultado de casos de uso HTTP autorizados.

## 4. Comunicação assíncrona

**Implementado (spec 001, ADR [0011](adr/0011-early-worker-and-outbox-for-email.md))**: Transactional Outbox para e-mails transacionais, do caso de uso na API até o SMTP.

```mermaid
sequenceDiagram
    participant UC as Caso de uso (apps/api)
    participant DB as PostgreSQL
    participant R as OutboxRelay (apps/worker)
    participant Q as BullMQ (fila emails)
    participant C as Consumidor (apps/worker)
    participant M as SMTP

    UC->>DB: alteração + INSERT outbox_events (mesma transação)
    loop a cada 1 s; lotes cheios em sequência
        R->>DB: BEGIN · SELECT … tipos roteados … LIMIT 50 FOR UPDATE SKIP LOCKED
        R->>Q: addBulk (jobId = id do evento)
        R->>DB: UPDATE published_at · COMMIT
    end
    Q->>C: job (até 5 tentativas, backoff exponencial de 5 s)
    C->>DB: upsert do token por evento (hash; novo a cada tentativa)
    C->>M: e-mail pt-BR com link APP_URL/…#token=…
```

- Relays concorrentes recebem lotes disjuntos (`SKIP LOCKED`). Se o commit falhar depois da publicação, o lote é republicado e o BullMQ ignora o `jobId` repetido, que fica retido por 24 h após a conclusão.
- O relay só lê os tipos que sabe rotear. Um evento de um produtor mais novo fica pendente até um worker que o conheça, sem bloquear os demais.
- Com o Redis indisponível, o lote falha, a transação é desfeita e o relay tenta de novo no ciclo seguinte.
- O consumidor valida cada job com Zod. Job inválido falha sem retry (`UnrecoverableError`); falha de SMTP volta para a fila. Como o token é regravado a cada tentativa, só o link do último envio funciona, e um evento reprocessado nunca gera um segundo token. Se o link do evento já foi usado, o reenvio é descartado (não se envia link morto).
- Avisos sem token (cadastro com e-mail existente, senha alterada) podem, raramente, chegar duplicados: entrega pelo menos uma vez.

**Planejado (Fase 2–4)**: eventos em processo para Socket.IO e as demais filas.

```mermaid
flowchart LR
    subgraph api[apps/api]
        uc[Use case] -->|tx| db[(PostgreSQL)]
        uc -->|após commit| disp[EventDispatcher in-process]
        disp --> sock[Socket.IO gateway]
        disp --> enq[Enfileirar job]
    end
    subgraph outboxflow[Outbox — implementada para e-mails]
        uc -->|mesma tx| outbox[(tabela outbox)]
        relay[Outbox relay] --> outbox
        relay --> q
    end
    enq --> q[(Redis / BullMQ)]
    q --> worker[apps/worker<br/>consumidores idempotentes]
    worker --> mail[E-mail]
    worker --> notif[Notificações persistidas]
    worker --> db
```

Garantias: entrega **pelo menos uma vez**; consumidores idempotentes (chave de idempotência por evento); retry com backoff exponencial e limite de tentativas; falhas permanentes vão para fila de falhas com alerta. Ver ADR [0008](adr/0008-domain-events-and-outbox.md).

## 5. Health check (implementado)

```mermaid
sequenceDiagram
    participant LB as Orquestrador / Load balancer
    participant API as GET /health/ready
    participant PG as PostgreSQL (SELECT 1)
    participant RD as Redis (PING)

    LB->>API: readiness
    par em paralelo, com timeout
        API->>PG: probe
        API->>RD: probe
    end
    API-->>LB: 200 { status: ready, checks[] } ou 503 { status: not_ready, checks[] }
```

`/health/live` responde 200 sem consultar dependências (o processo está vivo). Respostas expõem apenas nome, estado e latência de cada dependência — nunca mensagens de erro internas.
