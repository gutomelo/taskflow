# 0006 — Controle de concorrência com optimistic locking por versão

- **Status**: Aceito
- **Data**: 2026-10-08
- **Relacionados**: BR-008, BR-009 em [business-rules](../../product/business-rules.md)

## Contexto

Vários usuários editam as mesmas tarefas, colunas e sprints, inclusive em tempo real. Atualizações concorrentes não podem sobrescrever silenciosamente umas às outras (lost update).

## Alternativas consideradas

### A — Last write wins

- Contras: perde alterações sem aviso. Rejeitada.

### B — Locks pessimistas (`SELECT ... FOR UPDATE`) em toda edição

- Prós: serializa escritas.
- Contras: mantém locks durante interação humana impossível em HTTP stateless; reduz throughput.

### C — Optimistic locking com coluna `version`

- Prós: sem locks longos; conflito explícito ao cliente; simples com Prisma (`updateMany` condicional).
- Contras: cliente precisa lidar com 409.

## Decisão

Adotamos **C** para entidades editáveis (task, project, board column, sprint). O cliente envia a `version` conhecida; o repositório executa `updateMany({ where: { id, organizationId, version } , data: { ..., version: { increment: 1 } } })`; `count = 0` gera `VERSION_CONFLICT` (409). Locks pessimistas curtos (`FOR UPDATE` dentro de transação) são permitidos para invariantes de agregados que envolvem várias linhas (ex.: validar subtarefas na conclusão), sempre documentados no design da spec.

## Consequências

- **Positivas**: integridade sem degradação de throughput; UX explícita de conflito.
- **Negativas**: frontend precisa de fluxo de resolução (recarregar/mesclar).
- **Como verificar**: teste de integração com duas atualizações na mesma versão (uma 200, outra 409).
