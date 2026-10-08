# Fluxo de Git

- Branch principal: `master`. Trabalho em branches curtas: `feat/<spec>-<resumo>`, `fix/<resumo>`, `chore/<resumo>`, `docs/<resumo>`.
- Commits pequenos e coerentes, em inglês, Conventional Commits com escopo do contexto: `feat(tasks): enforce BR-001 on completion`, `chore(infra): add redis healthcheck`.
- Referencie a spec/tarefa no corpo do commit quando aplicável (`Spec: specs/004-tasks, task T3`).
- Antes de commitar: `pnpm verify` (ou ao menos `pnpm nx affected -t lint typecheck test`). Não commitar com testes falhando.
- Nunca commitar `.env`, credenciais, dumps de banco, `node_modules`, `dist` ou o Prisma Client gerado.
- Só commitar, fazer push, abrir PR ou reescrever histórico quando o usuário pedir. Nunca `push --force` em `master`.
- Lockfile (`pnpm-lock.yaml`) só muda via `pnpm add/remove/update`, nunca à mão.
- PR: descrição com objetivo, spec relacionada, como testar, evidências (saída dos testes) e riscos.
