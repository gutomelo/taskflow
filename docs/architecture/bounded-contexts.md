# Bounded contexts

Status: **Identity & Access** (spec 001), **Organizations** (spec 002) e **Projects** (spec 003) **implementados**; os demais **planejados**. A coluna "Spec/Fase" indica quando cada um nasce.

## Mapa de contextos

```mermaid
flowchart LR
    IAM["Identity & Access<br/>(identity)"]
    ORG["Organizations & Teams<br/>(organizations)"]
    PRJ["Projects<br/>(projects)"]
    TSK["Tasks<br/>(tasks)"]
    BRD["Boards<br/>(boards)"]
    SPR["Sprints<br/>(sprints)"]
    COL["Collaboration<br/>(collaboration)"]
    NOT["Notifications<br/>(notifications)"]
    ANA["Analytics<br/>(analytics)"]
    AUD["Audit<br/>(audit)"]

    ORG -- "usuário/identidade" --> IAM
    PRJ -- "configuração e papéis na org (FOR SHARE)" --> ORG
    ORG -. "mudança de papel (síncrona, mesma transação)" .-> PRJ
    TSK -- "acesso ao projeto (BR-003)" --> PRJ
    BRD -- "status/ordem de tarefas" --> TSK
    BRD -- "workflow do projeto" --> PRJ
    SPR -- "tarefas do backlog" --> TSK
    COL -- "alvo do comentário" --> TSK

    TSK -. eventos .-> NOT
    COL -. eventos .-> NOT
    TSK -. eventos .-> ANA
    SPR -. eventos .-> ANA
    ORG -. eventos .-> AUD
    TSK -. eventos .-> AUD
```

Setas sólidas: dependência de consulta (via porta na `application` do consumidor, implementada no composition root). Setas tracejadas: reação a eventos publicados após commit.

## Contextos

| Contexto              | Nome técnico    | Responsabilidades                                                                                                                                                | Não é responsável por                            | Spec/Fase                 |
| --------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------- |
| Identity & Access     | `identity`      | Usuários, credenciais (Argon2id), login/logout, refresh rotativo, recuperação de senha, sessões, resolução do contexto de autorização.                           | Papéis dentro de projetos; dados de organização. | 001 · F1                  |
| Organizations & Teams | `organizations` | Organizações (tenant), memberships e papéis organizacionais, convites, organização ativa (**implementado**, spec 002); equipes (planejado: spec que as usar).    | Credenciais; projetos.                           | 002 · F1                  |
| Projects              | `projects`      | Projetos, chave (BR-025), workflow padrão (configuração na 005), participantes e papéis no projeto (BR-027), arquivamento (BR-026) (**implementado**, spec 003). | Tarefas e sua ordem.                             | 003 · F1                  |
| Tasks                 | `tasks`         | Tarefas, status, prioridade, responsáveis, prazos, subtarefas, dependências, regras de conclusão (BR-001, 003, 006, 008).                                        | Layout do quadro; sprints.                       | 004 · F1                  |
| Boards                | `boards`        | Quadros Kanban, colunas mapeadas a status, posição/ordenação de cards, movimentação (BR-004, 009).                                                               | Regras de conclusão (delegadas a Tasks).         | 005 · F1                  |
| Sprints               | `sprints`       | Backlog, planejamento, sprints, associação de tarefas, encerramento/reabertura (BR-005).                                                                         | Estado das tarefas.                              | 007 · F3                  |
| Collaboration         | `collaboration` | Comentários, menções, histórico de discussão.                                                                                                                    | Entrega de notificações.                         | F2                        |
| Notifications         | `notifications` | Notificações in-app/e-mail, preferências, entrega assíncrona e em tempo real.                                                                                    | Decidir _o que_ aconteceu (reage a eventos).     | 008 · F2                  |
| Analytics             | `analytics`     | Indicadores, produtividade, métricas de projetos e sprints (modelos de leitura).                                                                                 | Escrever estado de outros contextos.             | 009 · F3                  |
| Audit                 | `audit`         | Registro imutável de alterações relevantes (BR-007), consulta administrativa.                                                                                    | Regras de negócio dos contextos auditados.       | Transversal · consulta F3 |

## Decisões de fronteira

- **Membership vs. permissão** (ADR [0013](adr/0013-authorization-shared-kernel.md), spec 006): `organizations` guarda quem pertence a qual organização e com que papel; `projects` guarda as participações e seus papéis (spec 003). O **vocabulário** de autorização (catálogos, matrizes, papel efetivo com teto da organização — BR-023) é Shared Kernel em `libs/backend/shared/kernel`, sem estado; a **decisão** fica no caso de uso de cada contexto, que recebe os dados de outro contexto por portas (ex.: `projects` lê "membros podem criar projetos" e `tasks` lê o papel de projeto). `identity` não participa da autorização além de autenticar.
- **Tasks × Boards**: o status é da tarefa (`tasks`); a coluna e a posição são do quadro (`boards`). Mover um card chama o caso de uso de transição de status de `tasks` (via porta) e grava a posição em `boards` na mesma transação (BR-010). Por isso estes dois contextos compartilham fronteira transacional — exceção documentada no design da spec 005.
- **Audit**: gravado na mesma transação da alteração (BR-007/010) por uma porta `AuditLog` implementada na infraestrutura de `audit`; a leitura pertence ao contexto `audit`.
- **Analytics**: lê de projeções próprias alimentadas por eventos; nunca consulta tabelas de outros contextos diretamente.
- **Tabelas**: cada contexto é dono das suas tabelas; outro contexto não lê nem escreve nelas via Prisma (apenas via portas).
- **`projects` × `organizations`** (spec 003): `projects` usa a porta `OrganizationAccess` (trava a organização `FOR SHARE` e relê configuração e papéis na mesma transação; lista membros para candidatos); `organizations` avisa toda mudança de papel pela porta `MembershipRoleChanges`, na sua linguagem, e `projects` decide (BR-027: rebaixado a viewer ⇒ participações viram viewer). Ordem única de locks: organização → projeto → participações. Seta pontilhada no mapa: reação **síncrona**, na transação de `organizations`, não evento pós-commit.

## Exceções de integridade referencial entre contextos (ADR 0015)

FKs entre tabelas de contextos diferentes só sob os critérios do [ADR 0015](adr/0015-cross-context-referential-integrity.md). A back-relation exigida pelo Prisma no modelo fornecedor é inerte (barrada por lint em `organizations`).

| FK                                                                                    | Ação                            | Spec | Motivo                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------- | ---- | -------------------------------------------------------------------- |
| `projects (organization_id) → organizations (id)`                                     | `CASCADE`, `ON UPDATE RESTRICT` | 003  | Toda tabela tenant-scoped tem FK para a organização (regra de banco) |
| `project_members (organization_id, user_id) → memberships (organization_id, user_id)` | `CASCADE`, `ON UPDATE RESTRICT` | 003  | Não existe participação sem membership (obrigação 2 da 006, BR-027)  |
