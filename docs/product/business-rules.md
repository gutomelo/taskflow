# Regras de negócio

Fonte canônica das regras BR-xxx. Specs referenciam estes IDs; testes usam o ID no nome (`it('BR-001: ...')`).

Status de todas as regras abaixo: **Documentada / não implementada** (Fase 0). A spec que implementa cada regra está indicada.

Convenções: "pendente" = não concluída nem cancelada. Erros têm `code` estável retornado em `ProblemDetails`.

---

## BR-001 — Conclusão exige subtarefas obrigatórias concluídas

- **Spec**: 004-tasks · **Contexto**: Tasks
- **Invariante**: uma tarefa em status de categoria `done` não possui subtarefa obrigatória (`isRequired = true`) pendente.
- **Pré-condições**: usuário autorizado a alterar a tarefa (BR-002); tarefa não arquivada.
- **Pós-condições**: tarefa concluída, `completedAt` registrado, `version` incrementada, evento `TaskCompleted` emitido após commit, auditoria registrada (BR-007).
- **Erros**: `TASK_HAS_PENDING_REQUIRED_SUBTASKS` (422) com a lista de IDs pendentes.
- **Concorrência**: a verificação das subtarefas e a mudança de status ocorrem na mesma transação; criar subtarefa obrigatória em tarefa concluída é rejeitado (`TASK_ALREADY_COMPLETED`, 422) para não violar a invariante a posteriori.
- **Casos limite**: subtarefa opcional pendente não bloqueia; subtarefa cancelada não bloqueia; reabrir a tarefa é permitido.
- **Validação**: sempre no backend (domínio). O frontend apenas antecipa o aviso.

## BR-002 — Somente usuários autorizados alteram tarefas

- **Spec**: 006-permissions + 004-tasks · **Contexto**: Identity & Access + Tasks
- **Regra**: alterar tarefa exige (a) membership ativa na organização, (b) acesso ao projeto, (c) permissão `task:update` pelo papel efetivo (ver [authorization.md](../security/authorization.md)).
- **Erros**: sem autenticação → 401; tarefa de outra organização ou projeto inacessível → 404 (`RESOURCE_NOT_FOUND`); papel sem permissão → 403 (`FORBIDDEN`).
- **Casos limite**: membro removido do projeto perde acesso imediatamente (permissões verificadas por request, não cacheadas no token além do papel básico); viewer nunca altera.

## BR-003 — Responsável precisa ter acesso ao projeto

- **Spec**: 004-tasks · **Contextos**: Tasks (consulta Projects via porta)
- **Invariante**: todo responsável (`assignee`) de uma tarefa é membro ativo do projeto, com papel que permite receber tarefas (não viewer).
- **Erros**: `ASSIGNEE_NOT_PROJECT_MEMBER` (422).
- **Pós-condição**: evento `TaskAssigned` após commit.
- **Casos limite**: ao remover um membro do projeto, suas atribuições abertas são desfeitas (ou bloqueiam a remoção) — decisão registrada na spec 003/004; atribuir a si mesmo segue a mesma regra.

## BR-004 — Movimentação respeita transições configuradas

- **Spec**: 005-kanban · **Contextos**: Boards + Tasks
- **Regra**: cada projeto define um workflow (status e transições permitidas). Mover um card entre colunas só é aceito se a transição `statusAtual → statusDestino` estiver permitida.
- **Erros**: `TRANSITION_NOT_ALLOWED` (422).
- **Interação**: mover para coluna de categoria `done` dispara as validações de BR-001 e BR-006.
- **Casos limite**: mover dentro da mesma coluna é só reordenação (BR-009); workflow padrão é criado com o projeto (`todo → in_progress → done`, com volta permitida).

## BR-005 — Sprint concluída não recebe tarefas

- **Spec**: 007-sprints · **Contexto**: Sprints
- **Invariante**: sprint com status `completed` não aceita inclusão de tarefas.
- **Erros**: `SPRINT_COMPLETED` (422).
- **Reabertura**: só por ação explícita `reopen` (se suportada pela spec 007), restrita a Project Manager+, auditada.
- **Casos limite**: tarefas não concluídas ao fechar a sprint voltam ao backlog ou vão para a próxima sprint, conforme escolha explícita no fechamento.

## BR-006 — Tarefa bloqueada não pode ser concluída

- **Spec**: 004-tasks · **Contexto**: Tasks
- **Invariante**: tarefa com dependência do tipo "bloqueada por" em tarefa pendente não pode ir para `done`.
- **Erros**: `TASK_BLOCKED_BY_DEPENDENCIES` (422) com IDs bloqueantes.
- **Integridade**: dependências não podem formar ciclo (`DEPENDENCY_CYCLE`, 422) e só existem entre tarefas da mesma organização.
- **Concorrência**: verificação na mesma transação da conclusão.

## BR-007 — Alterações relevantes são auditadas

- **Spec**: transversal (cada spec declara seus eventos auditáveis); consulta na Fase 3 · **Contexto**: Audit
- **Regra**: alterações relevantes registram `organizationId`, `actorUserId`, `resourceType`, `resourceId`, `action`, `occurredAt` (UTC) e, quando útil, diferenças resumidas (sem dados sensíveis).
- **Consistência**: o registro de auditoria é gravado **na mesma transação** da alteração (BR-010).
- **Relevantes (mínimo)**: mudanças de membership/papel, convites, criação/arquivamento de projeto, mudança de status/responsável/prazo de tarefa, fechamento/reabertura de sprint, mudanças de workflow.
- **Imutabilidade**: registros de auditoria não são editados nem apagados pela aplicação.

## BR-008 — Atualizações concorrentes não geram estado inconsistente

- **Spec**: 004-tasks (padrão para todas as entidades editáveis) · ADR 0006
- **Estratégia**: optimistic locking com coluna `version`. Toda alteração envia a versão conhecida; o update condicional falha se a versão mudou.
- **Erros**: `VERSION_CONFLICT` (409) com a versão atual; o frontend oferece recarregar/mesclar.
- **Casos limite**: ações idempotentes repetidas (mesmo `Idempotency-Key`) retornam o resultado original, não 409.

## BR-009 — Ordenação Kanban determinística

- **Spec**: 005-kanban · ADR 0007
- **Invariante**: dentro de uma coluna, as tarefas têm ordem total e estável: `(rank, id)`.
- **Movimento**: o cliente informa a posição relativa (`afterTaskId`/`beforeTaskId`); o servidor calcula a nova chave de ordenação entre os vizinhos.
- **Concorrência**: dois movimentos simultâneos para a mesma posição produzem ordem determinística (desempate por `id`), sem perder nenhum card; o resultado final é publicado em tempo real para todos.
- **Erros**: vizinho inexistente ou de outra coluna → `INVALID_POSITION` (422); conflito de versão do card → 409.

## BR-010 — Consistência transacional

- **Spec**: transversal · ADR 0008
- **Regra**: alteração do estado principal e registros obrigatoriamente associados (auditoria, contadores, outbox) são gravados atomicamente na mesma transação.
- **Efeitos externos** (fila, e-mail, socket) ocorrem somente após o commit; nunca são anunciados como concluídos antes disso.
- **Falha**: qualquer erro na transação desfaz tudo; o cliente recebe erro sem estado parcial.
