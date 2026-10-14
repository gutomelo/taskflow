# Regras de negócio

Fonte canônica das regras BR-xxx. Specs referenciam estes IDs; testes usam o ID no nome (`it('BR-001: ...')`).

Status: BR-001, BR-003 e BR-006 **implementadas e testadas** (spec 004); BR-004, BR-009 e BR-030 **implementadas e testadas** (specs 004 e 005: mudança de status, movimento de cards e workflow configurável); BR-008 aplicada a organizações, memberships, projetos e tarefas; BR-002, BR-005, BR-007 e BR-010 **documentadas** (dependem das specs 005+, salvo o que já está indicado); BR-028 e BR-029 **implementadas e testadas** (spec 004); BR-011…BR-018 **implementadas e testadas** (spec 001); BR-019…BR-022 **implementadas e testadas** (spec 002); BR-023 e BR-024 **implementadas e testadas** (spec 006; aplicadas a projetos na spec 003); BR-025…BR-027 **implementadas e testadas** (spec 003); BR-031 e BR-032 **implementadas e testadas** (spec 010); A spec que implementa cada regra está indicada.

Convenções: "pendente" = não concluída nem cancelada. Erros têm `code` estável retornado em `ProblemDetails`.

---

## BR-001 — Conclusão exige subtarefas obrigatórias concluídas

- **Spec**: 004-tasks · **Contexto**: Tasks
- **Invariante**: uma tarefa em status de categoria `done` não possui subtarefa obrigatória (`isRequired = true`) pendente.
- **Pré-condições**: usuário autorizado a alterar a tarefa (BR-002); tarefa não arquivada.
- **Pós-condições**: tarefa concluída, `completedAt`/`completedByUserId` registrados, `version` incrementada, evento `tasks.status_changed` no log após o commit (**implementado**). O evento de integração `TaskCompleted` e a auditoria (BR-007) são **planejados** (specs 008 e de auditoria).
- **Erros**: `TASK_HAS_PENDING_REQUIRED_SUBTASKS` (422) com os ids pendentes na extensão `taskIds` do Problem Details.
- **A invariante vale sempre** (D1 da spec 004): criar ou tornar obrigatória uma subtarefa pendente, reabrir ou tirar de `done` uma subtarefa obrigatória de pai concluído ⇒ `PARENT_TASK_COMPLETED` (422; substitui o `TASK_ALREADY_COMPLETED` do texto original); reabrir (cancelamento) um pai em `done` com obrigatória pendente ⇒ `TASK_HAS_PENDING_REQUIRED_SUBTASKS`. "Pai concluído" = status de categoria `done`, mesmo cancelado.
- **Concorrência**: concluir ou reabrir o pai e criar, reabrir ou tornar obrigatória uma subtarefa passam pelo lock do projeto em `tasks` (`task_project_locks`); testado com intercalações reais (spec 004, T8).
- **Casos limite**: subtarefa opcional pendente não bloqueia; subtarefa cancelada não bloqueia; subtarefas têm um nível só (`SUBTASK_DEPTH`) e "obrigatória" só existe em subtarefa (`REQUIRED_WITHOUT_PARENT`).
- **Validação**: sempre no backend (domínio). O frontend apenas antecipa o aviso.

## BR-002 — Somente usuários autorizados alteram tarefas

- **Spec**: 006-permissions + 004-tasks · **Contexto**: Identity & Access + Tasks
- **Regra**: alterar tarefa exige (a) membership ativa na organização, (b) acesso ao projeto, (c) permissão `task:update` pelo papel efetivo (ver [authorization.md](../security/authorization.md)).
- **Erros**: sem autenticação → 401; tarefa de outra organização ou projeto inacessível → 404 (`RESOURCE_NOT_FOUND`); papel sem permissão → 403 (`FORBIDDEN`).
- **Casos limite**: membro removido do projeto perde acesso imediatamente (permissões verificadas por request, não cacheadas no token além do papel básico); viewer nunca altera.

## BR-003 — Responsável precisa ter acesso ao projeto

- **Spec**: 004-tasks · **Contextos**: Tasks (consulta Projects via porta)
- **Invariante**: todo responsável (`assignee`) tem **papel efetivo** `manager` ou `member` no projeto (BR-023) — inclusive owner/admin da organização, que não são participantes gravados.
- **Erros**: `ASSIGNEE_NOT_PROJECT_MEMBER` (422), igual para viewer, não participante, inexistente ou de outra organização.
- **Pós-condição**: evento `tasks.assigned` (de/para) no log após o commit (**implementado**); `TaskAssigned` como evento de integração é **planejado** (spec 008).
- **Perda de acesso** (RF-11 da spec 004): deixar de ter papel efetivo manager/member num projeto — por qualquer caminho — desfaz as atribuições daquele projeto **na mesma transação**. A decisão é de `projects` (porta `ProjectContributorChanges`); `tasks` só executa. Quem continua contribuindo (ex.: admin com participação antiga saindo dela) mantém as atribuições. Remover alguém da organização ou sair **nunca** é bloqueado por tarefas: a FK `ON DELETE SET NULL ("assignee_user_id")` desatribui (ADR 0015).
- **Concorrência**: atribuir relê o papel do alvo com a membership e o projeto `FOR SHARE`; rebaixar trava a membership — nunca sobra um leitor como responsável (testado na spec 004, T8).

## BR-004 — Movimentação respeita transições configuradas

- **Spec**: 004-tasks + 005-kanban · **Contextos**: Tasks (status e quadro) + Projects (configuração do workflow, ADR 0016)
- **Regra**: cada projeto define um workflow (status e transições permitidas), **configurável pelo gerente** (`board:configure`, BR-030). Mover um card entre colunas só é aceito se a transição `statusAtual → statusDestino` estiver permitida.
- **Erros**: `TRANSITION_NOT_ALLOWED` (422).
- **Interação**: mover para coluna de categoria `done` dispara as validações de BR-001 e BR-006.
- **Casos limite**: mover dentro da mesma coluna é só reordenação (BR-009); workflow padrão é criado com o projeto (`todo → in_progress → done`, com volta permitida).
- **Estado**: o workflow padrão ("A fazer", "Em andamento", "Concluído", com transições de ida e volta entre vizinhos) é **implementado** na spec 003 e criado com o projeto. A validação de transições é **implementada** na mudança de status de tarefa (spec 004, `assertTransitionAllowed` em `tasks/domain`, inclusive "mesmo status não é transição"); mover cards no quadro usa o mesmo núcleo (spec 005, `MoveCard`), e as transições são editáveis (BR-030).

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
- **Integridade**: dependências só existem entre tarefas do **mesmo projeto** (garantido também pelas FKs compostas) e não formam ciclo (`DEPENDENCY_CYCLE`, 422), inclusive o implícito "pai bloqueado pelas subtarefas obrigatórias" (D4: subtarefa obrigatória não pode ser bloqueada, direta ou indiretamente, pelo próprio pai). Busca em largura limitada a 64 níveis e 500 tarefas; tetos de 50 bloqueadoras por tarefa e 5 000 dependências por projeto (`DEPENDENCY_LIMIT_REACHED`, 422).
- **Precondição** (D2): só vale ao concluir; tarefa concluída pode ganhar bloqueadora, e reabrir a bloqueadora não "desconclui". Bloqueadora concluída ou cancelada não bloqueia.
- **Concorrência**: dependências e conclusões passam pelo lock do projeto em `tasks`; duas dependências opostas em paralelo ⇒ uma recusada como ciclo (testado na spec 004, T8).

## BR-007 — Alterações relevantes são auditadas

- **Spec**: transversal (cada spec declara seus eventos auditáveis); consulta na Fase 3 · **Contexto**: Audit
- **Regra**: alterações relevantes registram `organizationId`, `actorUserId`, `resourceType`, `resourceId`, `action`, `occurredAt` (UTC) e, quando útil, diferenças resumidas (sem dados sensíveis).
- **Consistência**: o registro de auditoria é gravado **na mesma transação** da alteração (BR-010).
- **Relevantes (mínimo)**: mudanças de membership/papel, convites, criação/arquivamento de projeto, mudança de status/responsável/prazo de tarefa, fechamento/reabertura de sprint, mudanças de workflow.
- **Imutabilidade**: registros de auditoria não são editados nem apagados pela aplicação.
- **Desvio registrado (spec 002)**: mudanças de membership/papel e convites vão, por ora, ao **log estruturado de segurança** (eventos `organizations.*`, só ids), não a uma trilha transacional e imutável. A trilha em banco nasce com o contexto `audit` (Fase 3); aceitável enquanto não há dados de produção.

## BR-008 — Atualizações concorrentes não geram estado inconsistente

- **Spec**: 004-tasks (padrão para todas as entidades editáveis) · ADR 0006
- **Estratégia**: optimistic locking com coluna `version`. Toda alteração envia a versão conhecida; o update condicional falha se a versão mudou.
- **Erros**: `VERSION_CONFLICT` (409) com a versão atual; o frontend oferece recarregar/mesclar.
- **Casos limite**: ações idempotentes repetidas (mesmo `Idempotency-Key`) retornam o resultado original, não 409.

## BR-009 — Ordenação Kanban determinística

- **Spec**: 005-kanban · ADRs 0007 e 0016 · **Implementada e testada**
- **Invariante**: dentro de uma coluna, os cards (tarefas de primeiro nível não canceladas) têm ordem total e estável: `(board_rank, id)`, chave fracionária comparada em ASCII (collation `"C"`).
- **Movimento**: o cliente informa a posição relativa (`afterTaskId`/`beforeTaskId`); o servidor calcula a nova chave de ordenação entre os vizinhos.
- **Concorrência**: dois movimentos simultâneos para a mesma posição produzem ordem determinística (desempate por `id`), sem perder nenhum card; os movimentos de um projeto são serializados pelo lock do projeto em `tasks`. Chaves empatadas ou longas demais disparam o rebalanceamento da coluna (limitado por projeto). **Sem tempo real nesta fase** (decisão 5 da spec 005): o cliente recarrega; a publicação por Socket.IO é da Fase 2.
- **Erros**: vizinho inexistente, de outra coluna, de outro projeto, subtarefa ou cancelado → `INVALID_POSITION` (422, mesmo corpo); mover subtarefa → `TASK_NOT_A_CARD` (422); versão do card → 409 (conferida sempre; incrementada só ao mudar de coluna).
- **Fim da coluna**: tarefa criada, movida pelo detalhe ou reaberta entra no fim da coluna do seu status.

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

Criar ou entrar em organização exige e-mail verificado — **implementado na spec 002** pela porta `UserDirectory` de `organizations` (`emailVerified` lido de `identity` a cada operação, nunca do JWT). Login e gestão da própria conta não exigem.

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

## Organizations & multi-tenancy (spec 002)

### BR-019 — Sempre um owner

Toda organização tem ≥ 1 membro com papel `owner`. O último owner não sai, não é removido nem rebaixado (`LAST_OWNER`, 409). Mudanças no conjunto de owners são serializadas por organização (lock `FOR NO KEY UPDATE` da organização + releitura de ator e alvo); a checagem vem antes da política de papéis, para que no rebaixamento mútuo simultâneo quem perde receba `LAST_OWNER`.

### BR-020 — Convite nominal

Convite vale para um e-mail, um papel (`admin`, `member` ou `viewer`) e uma organização; uso único; expira em 7 dias; aceito apenas por conta autenticada com aquele e-mail verificado — outra conta recebe 403 `INVITATION_FOR_ANOTHER_ACCOUNT` sem consumir. Um convite aberto por e-mail e organização: reenviar ou reconvidar (que atualiza o papel) emite novo link e invalida o anterior na hora. E-mail que já é membro ⇒ 409 `ALREADY_A_MEMBER`. O aceite revalida que o convidante ainda pode conceder o papel.

### BR-021 — Hierarquia de papéis

Só `owner` promove alguém a owner ou altera/remove um owner; `admin` gerencia papéis e remoções entre `admin`, `member` e `viewer`. Ninguém altera o próprio papel, exceto o owner que se rebaixa havendo outro owner. Quem deixa de poder convidar (removido ou rebaixado a member/viewer) tem seus convites abertos revogados na mesma transação.

### BR-022 — Slug da organização

Único globalmente, 3–40 caracteres `[a-z0-9-]`, começando por letra, sem hífen no fim nem duplo; palavras reservadas recusadas contra impersonação (`admin`, `support`, `taskflow`, `security`…); imutável após a criação (`SLUG_TAKEN` 409, `INVALID_SLUG` 400).

## Permissões (spec 006)

### BR-023 — Papel efetivo no projeto

Owner/admin da organização atuam como `manager` em todos os projetos. Member da organização tem o papel do projeto. Viewer da organização tem no máximo `viewer` em qualquer projeto (o papel da organização é teto; rebaixar na organização reduz o efetivo sem alterar dados do projeto). Sem participação no projeto ⇒ sem acesso: o projeto responde 404 e não aparece em listas.

### BR-024 — Criação de projetos configurável

Owner e admin sempre criam projetos. Members criam se a organização permitir ("membros podem criar projetos", padrão: sim). Viewers nunca criam. Alterar a configuração exige owner/admin e respeita BR-008 (versão da organização).

## Projetos (spec 003)

### BR-025 — Chave do projeto

2 a 10 caracteres, letras maiúsculas sem acento e dígitos, começando por letra (`[A-Z][A-Z0-9]{1,9}`); única na organização, incluindo projetos arquivados; definida na criação e imutável. A API não normaliza (minúsculas são recusadas; a interface converte ao digitar). Erros: `INVALID_PROJECT_KEY` (400), `PROJECT_KEY_TAKEN` (409).

### BR-026 — Projeto arquivado é somente leitura

Arquivado não aceita edição, novas participações nem mudanças de papel (`PROJECT_ARCHIVED`, 409); continua legível por quem tem acesso e sai da lista padrão. Remover participante e sair continuam permitidos. Arquivar e restaurar exigem `project:archive`, são idempotentes (já no estado pedido ⇒ 200 com a versão atual) e, fora disso, exigem a versão (BR-008). A spec 004 estende a regra a tarefas (**implementado**: toda escrita de tarefa ⇒ `PROJECT_ARCHIVED`, depois do 403; arquivar espera a criação em andamento); a 005 a estende a quadros.

### BR-027 — Participação no projeto

Só membros da organização participam (`MEMBER_NOT_FOUND`, 404, igual para inexistente e de outra organização). O papel gravado nunca passa do teto: viewer na organização ⇒ só `viewer` (`PROJECT_ROLE_ABOVE_CEILING`, 422). Owner e admin da organização não são gravados como participantes (`ALREADY_MANAGES_ALL_PROJECTS`, 422 — já gerenciam todos os projetos). Sair ou ser removido da organização apaga as participações (FK em cascata, ADR 0015); ser rebaixado a viewer na organização rebaixa as participações a `viewer` na mesma transação, com versão incrementada, e promover de volta não as restaura. Participar duas vezes ⇒ `ALREADY_A_PROJECT_MEMBER` (409). Sair do projeto é sempre permitido a quem participa.

## Tarefas (spec 004)

### BR-028 — Número da tarefa

Cada projeto numera as tarefas em sequência (`CHAVE-N`, ex.: `WEB-42`), a partir de 1, por um contador próprio (`task_counters`, `upsert` atômico); um número **nunca é reutilizado**, nem depois de excluir a tarefa. Criações simultâneas recebem números distintos (também garantido por índice único). Teto de 10 000 números por projeto e 100 000 tarefas por organização (`TASK_LIMIT_REACHED`, 422).

### BR-029 — Tarefa cancelada

Cancelar e reabrir são ações próprias, independentes do status, que registram quando e quem (idempotentes). Cancelada sai das listas padrão (filtro `canceled=true` a inclui), não conta como pendente em BR-001 nem em BR-006 e é só leitura até ser reaberta (`TASK_CANCELED`, 409); pode ser excluída.

## Kanban (spec 005)

### BR-030 — Workflow configurável

O gerente do projeto (`board:configure`) cria, renomeia, reordena e remove status e define as transições, sempre com a versão do workflow (BR-008). Nomes de 1 a 40 caracteres de texto exibível, únicos no projeto sem diferenciar maiúsculas (`STATUS_NAME_TAKEN`, 409); sempre ao menos um status `todo` — o primeiro pela ordem é o inicial das tarefas novas (`WORKFLOW_NEEDS_TODO_STATUS`, 422); no máximo 20 status (`STATUS_LIMIT_REACHED`, 422). A **categoria só muda em status sem nenhuma tarefa** — canceladas e subtarefas contam (`STATUS_IN_USE`, 409): a conclusão das tarefas nunca muda por configuração. Remover um status com tarefas exige outro status **da mesma categoria** para recebê-las (`INVALID_STATUS_TARGET`, 422); a reatribuição e a remoção acontecem juntas, e as transições do status removido caem. Transições ligam status distintos do workflow, sem repetição (`INVALID_TRANSITION`, 422). Referências fora do workflow ⇒ `STATUS_NOT_FOUND` (404), antes das regras.

## Comentários e menções (spec 010)

### BR-031 — Comentário

Texto simples de 1 a 5 000 caracteres (code points) depois de normalizar (NFC, fins de linha `\n`, bordas aparadas), Unicode bem formado, sem caracteres de controle além de quebra de linha e tabulação, sem formatação bidi e sem pilhas de marcas combinantes (`INVALID_COMMENT_BODY`, 400). Autor fixo; editar só o autor, com versão (BR-008; `VERSION_CONFLICT`, 409), mostrando "editado". Excluir — o autor ou o gerente do projeto (moderação) — troca o texto por "comentário removido" de forma irreversível e idempotente, apagando as menções; removido não se edita (`COMMENT_DELETED`, 409). Projeto arquivado (BR-026) e tarefa cancelada (BR-029) impedem comentar e editar, **mas não excluir** (decisão 9 da spec 010). Ordem `(criado em, id)`; teto suave de 2 000 comentários não removidos por tarefa (`COMMENT_LIMIT_REACHED`, 422). Quem saiu da organização aparece como "Ex-membro".

### BR-032 — Menção

Menção é o token `<@id>` no texto, gravado também como linha estruturada. Só vale para quem lê o projeto no momento da escrita, conferido sob lock; na edição, só as menções **novas** são conferidas (as mantidas continuam válidas). Qualquer outro caso — inexistente, de outra organização ou sem acesso — responde o mesmo `INVALID_MENTION` (422). Sem repetição; o autor não se menciona; no máximo 20 pessoas por comentário (`TOO_MANY_MENTIONS`, 422). Mencionar não concede acesso. Só as menções novas geram evento (`collaboration.comment_created`/`comment_edited`); a entrega de notificações é da spec 008, que confere o acesso na entrega.
