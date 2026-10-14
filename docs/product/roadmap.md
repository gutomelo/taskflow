# Roadmap

Legenda de status: **Concluído** · **Em andamento** · **Planejado** · **Não iniciado**.

Regra: nenhuma fase antecipa recursos de fases posteriores sem necessidade comprovada e registrada em spec/ADR.

## Fase 0 — Fundação · Concluído

Spec: [`specs/000-foundation`](../../specs/000-foundation/requirements.md)

- Context Engineering para Claude Code (CLAUDE.md, regras, agentes, skills, hooks).
- Documentação de arquitetura, ADRs iniciais, regras de negócio, matriz de permissões.
- Processo SDD com templates.
- Monorepo Nx: `apps/web` (Angular), `apps/api` (Express), libs mínimas, limites de dependência.
- Prisma configurado, Docker Compose (PostgreSQL + Redis), health checks.
- Qualidade: lint, typecheck, testes unitários/integração/E2E iniciais, CI no GitHub Actions, Dependabot.

## Fase 1 — MVP · Em andamento (specs 001, 002, 006, 003 e 004 concluídas)

| Ordem | Spec                 | Conteúdo                                                                                                                                |
| ----- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `001-authentication` | **Concluída.** Registro, login, logout, refresh rotativo, recuperação de senha, sessões.                                                |
| 2     | `002-organizations`  | **Concluída.** Organizações (tenant), membros, convites, troca de organização ativa. Equipes adiadas para a spec que as usar.           |
| 3     | `006-permissions`    | **Concluída.** Papéis, matriz de permissões (Shared Kernel), capacidades na API, harness de isolamento (RLS: ADR 0014).                 |
| 4     | `003-projects`       | **Concluída.** Projetos com chave, participantes com teto, workflow padrão, arquivamento (ADR 0015).                                    |
| 5     | `004-tasks`          | **Concluída.** Tarefas, prioridade, responsável, prazos, subtarefas, dependências, cancelamento (BR-001, 003, 004, 006, 008, 028, 029). |
| 6     | `005-kanban`         | Quadros, colunas, transições configuráveis, ordenação, movimentação (BR-004, 009).                                                      |

> A spec `006-permissions` é implementada logo após organizações porque todas as features seguintes dependem dela, embora mantenha a numeração original.

## Fase 2 — Colaboração · Não iniciado

Comentários e menções (Collaboration), notificações in-app (`008-notifications`), Socket.IO para Kanban/tarefas/notificações, histórico de atividades, melhorias de usabilidade.

## Fase 3 — Gestão avançada · Não iniciado

Backlog e sprints (`007-sprints`, BR-005), dashboards e indicadores (`009-analytics`), auditoria administrativa completa (BR-007 com consulta/retensão), regras avançadas.

## Fase 4 — Robustez · Não iniciado

Novas filas do `apps/worker` (notificações, outros jobs agendados) — worker, BullMQ e Outbox já existem desde a spec 001 para e-mails e retenção (ADR 0011) —, OpenTelemetry (traces/métricas), testes de carga, RLS como defesa adicional (adiado pela spec 006 — ADR 0014, com gatilhos de reavaliação antecipada), CI/CD com deploy independente de web/api/worker.

> A exceção prevista aconteceu: a spec 001 antecipou `apps/worker`, BullMQ e a Outbox para os e-mails transacionais (ADR 0011).
