# Regras de negócio

Fonte canônica das regras BR-xxx. Specs referenciam estes IDs; testes usam o ID no nome (`it('BR-001: ...')`).

Status: BR-001…BR-010 **documentadas / não implementadas** (dependem das specs 002+); BR-011…BR-018 **implementadas e testadas** (spec 001). A spec que implementa cada regra está indicada.

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

---

## Identity & Access (spec 001)

Status: **Implementadas e testadas** (spec [001-authentication](../../specs/001-authentication/requirements.md)). Detalhes em [design.md](../../specs/001-authentication/design.md) e evidências em [tasks.md](../../specs/001-authentication/tasks.md). Os esclarecimentos marcados com _rev. 4_ vêm das correções da T29 (revisão 4 do design, aprovada em 2026-10-09).

### BR-011 — Política de senha

8–128 caracteres, com ao menos uma letra maiúscula, uma minúscula, um dígito e um símbolo; não pode ser igual ao e-mail nem constar na lista local de senhas comuns/vazadas (100 mil mais frequentes). Validada no backend (domínio); o frontend apenas antecipa o feedback. Erro: `PASSWORD_POLICY_VIOLATION` (422) listando as regras não atendidas.

### BR-012 — Rotação de refresh token

Cada uso emite novo refresh e invalida o anterior. Reapresentar um refresh rotacionado revoga a sessão inteira (`SESSION_REVOKED`, 401) e registra evento de segurança — **exceto** uma única vez para o predecessor imediato, até 5 s após a rotação, vindo do mesmo cliente (prefixo de IP e user agent), que recebe 409 `REFRESH_IN_PROGRESS` sem revogar.

### BR-013 — Gate de e-mail verificado

Criar ou entrar em organização exige e-mail verificado (aplicado pela spec 002 por porta própria ligada a uma consulta desta spec). Login e gestão da própria conta não exigem.

### BR-014 — Não enumeração de contas

Cadastro, recuperação de senha e reenvio respondem igual para e-mails existentes e inexistentes; o titular de uma conta existente recebe e-mail informativo ("você já tem conta") no lugar do link de verificação. Envios a um mesmo e-mail são limitados e o excesso é suprimido silenciosamente — com orçamentos separados por finalidade (verificação × recuperação), e na recuperação por endereço **e** rede de origem, para que terceiros não esgotem os links da vítima (_rev. 4_).

### BR-015 — Expiração de sessão

Sessão expira após 7 dias sem uso (deslizante) ou 30 dias após o login (absoluto), o que ocorrer primeiro. Access token: 15 min.

### BR-016 — Troca/redefinição de senha

Trocar a senha revoga todas as outras sessões, rotaciona a sessão atual e invalida tokens de recuperação pendentes; redefinir por e-mail revoga todas as sessões e invalida tokens de recuperação pendentes. Pedidos de recuperação feitos antes da troca e ainda não processados (fila) também caducam (_rev. 4_).

### BR-017 — Confirmação de e-mail pelo titular

O link de verificação só confirma o e-mail quando usado por uma sessão autenticada da **mesma conta** e por ação explícita do usuário; evita que uma conta criada por terceiro com o e-mail da vítima seja verificada pelo clique da vítima (pré-sequestro).

### BR-018 — Atraso progressivo de login

Após 5 falhas consecutivas para uma conta, cada nova tentativa exige espera que dobra (1 s até 15 min), zerada no sucesso; sem bloqueio permanente. Tentativas da mesma conta são processadas uma de cada vez; as simultâneas recebem 429, para que palpites paralelos não contornem a espera (_rev. 4_).
