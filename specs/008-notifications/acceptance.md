# 008 — Notificações · Aceitação

## Cenários

### CA-01 — Menção (BR-033)

```gherkin
Dado Ana e Bia participantes do projeto WEB
Quando Ana comenta em WEB-1 mencionando Bia
Então Bia recebe uma notificação "Ana mencionou você em WEB-1"
E Ana não recebe notificação da própria menção
Quando Ana edita o comentário tirando e repondo a menção a Bia
Então Bia continua com uma única notificação daquele comentário
Quando Ana edita acrescentando Caio
Então só Caio recebe uma notificação nova
```

### CA-02 — Atribuição (BR-033)

```gherkin
Dado Ana e Bia participantes do projeto WEB
Quando Ana cria WEB-2 com Bia como responsável, ou troca o responsável de WEB-1 para Bia
Então Bia recebe "Ana atribuiu WEB-… a você"
Quando Bia atribui uma tarefa a si mesma
Então nenhuma notificação é criada
```

### CA-03 — Confiabilidade (RF-03)

```gherkin
Dado o worker parado
Quando Ana menciona Bia e atribui uma tarefa a ela
Então os eventos ficam na Outbox e nenhuma notificação existe ainda
Quando o worker volta
Então cada notificação é criada exatamente uma vez, mesmo que o job seja reprocessado
E se a transação do comentário falhar, nenhum evento é gravado
E um destinatário que saiu da organização antes do processamento é descartado sem impedir os outros
```

### CA-04 — Lista e leitura

```gherkin
Dado Bia com três notificações em Acme e uma em outra organização
Quando Bia abre as notificações em Acme
Então vê só as três de Acme, mais recentes primeiro, com ator, tipo, chave e título da tarefa
E o contador mostra 3
Quando abre uma, ela é marcada como lida e o contador mostra 2
Quando marca todas como lidas, o contador mostra 0
```

### CA-05 — Validade (decisão 6)

```gherkin
Dado Bia com uma notificação de menção e uma de atribuição em WEB
Quando o comentário é removido, ou a menção tirada
Então a notificação de menção some da lista e do contador
Quando Bia perde o acesso ao projeto WEB
Então nenhuma das notificações de WEB aparece (sem título vazado)
Quando a tarefa é excluída ou Bia sai da organização
Então as notificações correspondentes são apagadas
```

### CA-06 — Resumo por e-mail (BR-034)

```gherkin
Dado Bia com notificações não lidas em duas organizações e a preferência ligada
Quando o job do resumo roda
Então Bia recebe um e-mail de assunto fixo, agrupado pelo slug de cada organização, com contagens por tipo, chaves e links — sem nome de pessoa, título, texto nem nome de organização
E as notificações enviadas não entram em outro resumo
Quando o job roda de novo em menos de uma hora
Então Bia não recebe outro e-mail
Dado Caio com a preferência desligada
Então Caio não recebe e-mail, mas vê as notificações no app
Quando Caio religa a preferência
Então o próximo resumo traz só notificações das últimas 24 h
E um nome de exibição com domínio, "<" ou quebra de linha nunca aparece no e-mail
```

### CA-07 — Antispam

```gherkin
Dado Ana mencionando Bia em muitos comentários dentro de uma hora
Quando passa do teto de menções por (ator, destinatário)
Então as excedentes não viram notificação e o descarte é registrado em log só com ids
E Ana atribuindo 30 tarefas a Bia gera 30 notificações (atribuição sem teto)
```

### CA-08 — Isolamento e autorização

```gherkin
Dado as organizações A e B
Quando as rotas de notificação são chamadas sob o prefixo de A com ids ou cursores de B
Então respondem 404 ou 400 sem dados alheios e sem efeito
E nenhuma pessoa — nem owner nem admin da mesma organização — lê, conta ou marca notificação de outra (mesmo 404 de inexistente e de própria invisível)
E "marcar todas" não altera notificações de terceiros
```

### CA-09 — Interface

```gherkin
Dado Bia logada em Acme com 2 notificações não lidas
Então o sino mostra 2 e é anunciado como "Notificações, 2 não lidas"
Quando abre a lista e escolhe uma
Então vai para a tarefa e a notificação fica lida
E na página da conta Bia desliga o resumo por e-mail
```

### CA-10 — Jornada

```gherkin
Dado o owner e o membro da jornada de projetos
Quando o owner menciona o membro e atribui uma tarefa a ele
Então o membro vê as duas notificações no sino
E o resumo chega no Mailpit sem nomes, título nem texto da tarefa
```

## Testes obrigatórios

- [x] Domínio: notificação, deduplicação, preferência
- [x] Casos de uso com fakes: registro (dedupe, teto, leitores), leitura com validade, marcar lida(s), preferência, resumo, retenção
- [x] Integração: catálogo e cascatas, repositórios, produtores com Outbox, worker (parado/voltando, idempotência, SMTP de teste), harness e bateria
- [x] HTTP: contratos, 400/404/409/429, OpenAPI
- [x] Frontend: sino com polling, lista, preferência
- [x] E2E: jornada real; jornadas existentes verdes

## Evidências de validação

| Critério | Evidência (comando + resultado)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Data       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| CA-01    | `notifications.use-cases.spec.ts` ("records one per recipient, never for the actor…", "D4: removing and re-adding a mention…"); `collaboration-integration-events.spec.ts` (só menções novas); `notification-jobs.spec.ts` (tradução da menção); `notification-delivery.integration.spec.ts` (menção registrada para bia e dani, nunca para a autora); E2E passo "spec 008"                                                                                                                   | 2026-10-15 |
| CA-02    | `notifications.use-cases.spec.ts` ("assigning to oneself notifies nobody; each assignment is a new fact"); `tasks-integration-events.spec.ts`; `notifications-isolation.integration.spec.ts` (atribuição via HTTP grava `tasks.assignee_changed` na outbox); E2E (PDC-1)                                                                                                                                                                                                                      | 2026-10-15 |
| CA-03    | Rollback dos produtores (BR-010, T4); `notification-delivery.integration.spec.ts` ("records the events written while the worker was stopped…", "is idempotent: a republished event…", "a recipient who left… is dropped (FK)"); `notifications-persistence.integration.spec.ts` (inelegível nunca é erro)                                                                                                                                                                                     | 2026-10-15 |
| CA-04    | `notifications.use-cases.spec.ts` (lista, páginas curtas, cursor, contador com teto 99, `read-all` com `upToId`); `notifications-router.spec.ts`; `notifications.spec.ts` do web (página, "carregar mais", marcar todas)                                                                                                                                                                                                                                                                      | 2026-10-15 |
| CA-05    | `notifications.use-cases.spec.ts` ("decision 6: a mention removed, a task no longer readable or an ex-member actor", "B4: a failing port propagates"); `collaboration-persistence.integration.spec.ts` (menções ativas amarradas à tarefa); `notifications-schema.integration.spec.ts` (cascatas)                                                                                                                                                                                             | 2026-10-15 |
| CA-06    | `notifications.use-cases.spec.ts` (bloco digest); `pt-br-digest-mailer.spec.ts` (valores hostis, sem o nome do destinatário); `notification-delivery.integration.spec.ts` ("BR-034: the hourly plan sends one digest per person…", `jobId` por hora, quem não lê não recebe); E2E (resumo no Mailpit sem nomes, títulos nem texto)                                                                                                                                                            | 2026-10-15 |
| CA-07    | `notifications.use-cases.spec.ts` ("decision 9: mentions are capped…", limites por usuário, inclusive preferência — auditoria B1); `notifications-persistence.integration.spec.ts` (contagem por `occurred_at`)                                                                                                                                                                                                                                                                               | 2026-10-15 |
| CA-08    | `organizations-isolation.integration.spec.ts` (4 casos de notificação, cursor `noLeak`, `/me` na allowlist); `notifications-isolation.integration.spec.ts` (owner, admin, member e viewer: 404 idêntico, `read-all` sem tocar terceiros no banco, a própria de B pelo caminho de A); `route-coverage.spec.ts`                                                                                                                                                                                 | 2026-10-15 |
| CA-09    | `notifications.spec.ts` do web (sino "Notificações, 2 não lidas", 99+, polling de 60 s, visibilidade, anúncio repetido, resposta velha descartada, abrir marca como lida e navega, preferência com reversão); `notifications-contract-guards.spec.ts`                                                                                                                                                                                                                                         | 2026-10-15 |
| CA-10    | `apps/web-e2e/src/projects-journey.spec.ts` (passo "spec 008"): `playwright test` 19 passed (49,1 s)                                                                                                                                                                                                                                                                                                                                                                                          | 2026-10-15 |
| Gate     | `pnpm verify`: exit 0, 102 tarefas (92 do cache do Nx, mesmo hash de entradas); `pnpm test:integration --skip-nx-cache`: exit 0, 9 projetos, **272 testes** (api 63, worker 14, notifications 13, …); E2E 19 de 19                                                                                                                                                                                                                                                                            | 2026-10-15 |
| Revisões | `/review-code`: sem bloqueantes; I1 (resposta velha do contador desfazia a baixa e anunciava falso aumento; duplo clique) corrigido com testes e 4 mutantes mortos; I2 resolvido no fechamento; S1–S6 aplicadas (S5 como risco aceito). `/security-audit`: sem Críticos, Altos ou Médios; B1 (limite da preferência) corrigido com teste e 2 mutantes mortos; B2 registrado como risco **Proposto** para decisão do usuário; B3 (gatilho do ADR 0014) reavaliado no design: adiamento mantido | 2026-10-15 |

## Definição de concluído

- [x] CA-01 a CA-10 comprovados por testes executados
- [x] `pnpm verify`, `pnpm test:integration` e E2E passando
- [x] `/review-code` sem bloqueantes e `/security-audit` sem Críticos/Altos abertos
- [x] Documentação, regras de negócio (BR-033, BR-034), ADRs, roadmap e índice atualizados
