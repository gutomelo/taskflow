# Roadmap

Legenda de status: **Concluído** · **Em andamento** · **Planejado** · **Não iniciado**.

Regra: nenhuma fase antecipa recursos de fases posteriores sem necessidade comprovada e registrada em spec/ADR.

## Fase 0 — Fundação · Em andamento

Spec: [`specs/000-foundation`](../../specs/000-foundation/requirements.md)

- Context Engineering para Claude Code (CLAUDE.md, regras, agentes, skills, hooks).
- Documentação de arquitetura, ADRs iniciais, regras de negócio, matriz de permissões.
- Processo SDD com templates.
- Monorepo Nx: `apps/web` (Angular), `apps/api` (Express), libs mínimas, limites de dependência.
- Prisma configurado, Docker Compose (PostgreSQL + Redis), health checks.
- Qualidade: lint, typecheck, testes unitários/integração/E2E iniciais, CI no GitHub Actions, Dependabot.

## Fase 1 — MVP · Não iniciado

| Ordem | Spec                 | Conteúdo                                                                                     |
| ----- | -------------------- | -------------------------------------------------------------------------------------------- |
| 1     | `001-authentication` | Registro, login, logout, refresh rotativo, recuperação de senha, sessões.                    |
| 2     | `002-organizations`  | Organizações (tenant), membros, convites, troca de organização ativa, equipes básicas.       |
| 3     | `006-permissions`    | Papéis, matriz de permissões, políticas por recurso, testes de isolamento.                   |
| 4     | `003-projects`       | Projetos, membros do projeto, configurações, arquivamento.                                   |
| 5     | `004-tasks`          | Tarefas, prioridade, responsáveis, prazos, subtarefas, dependências (BR-001, 003, 006, 008). |
| 6     | `005-kanban`         | Quadros, colunas, transições configuráveis, ordenação, movimentação (BR-004, 009).           |

> A spec `006-permissions` é implementada logo após organizações porque todas as features seguintes dependem dela, embora mantenha a numeração original.

## Fase 2 — Colaboração · Não iniciado

Comentários e menções (Collaboration), notificações in-app (`008-notifications`), Socket.IO para Kanban/tarefas/notificações, histórico de atividades, melhorias de usabilidade.

## Fase 3 — Gestão avançada · Não iniciado

Backlog e sprints (`007-sprints`, BR-005), dashboards e indicadores (`009-analytics`), auditoria administrativa completa (BR-007 com consulta/retensão), regras avançadas.

## Fase 4 — Robustez · Não iniciado

`apps/worker` com BullMQ (e-mails, notificações, jobs agendados), Transactional Outbox quando justificado, OpenTelemetry (traces/métricas), testes de carga, RLS como defesa adicional (ADR 0004), CI/CD com deploy independente de web/api/worker.

> Exceção prevista: se a Fase 1 exigir envio real de e-mail (recuperação de senha, convites), a spec correspondente decide entre envio síncrono com timeout ou antecipar `apps/worker` — registrando a decisão em ADR.
