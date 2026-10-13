# 0014 — Row Level Security adiado para a Fase 4

- **Status**: Aceito (2026-10-13, com a aprovação da spec 006)
- **Data**: 2026-10-13
- **Decisores**: usuário (product owner); arquitetura e segurança (Claude Code, revisão da spec 006)
- **Relacionados**: substitui a parte "RLS — Proposto" do [ADR 0004](0004-multi-tenancy-shared-database.md) (a estratégia base continua aceita); [ADR 0012](0012-tenant-in-api-path.md); [spec 006](../../../specs/006-permissions/design.md)

## Contexto

O ADR 0004 adotou o isolamento por `organization_id` filtrado na aplicação e deixou o RLS como "Proposto", com decisão prevista na spec 006. Com Prisma 7 e `@prisma/adapter-pg`, o RLS exige `set_config('app.organization_id', …, true)` dentro de cada transação (inclusive nas leituras), um papel de banco sem `BYPASSRLS` para a aplicação e outro para migrations e worker, políticas por tabela e cuidado com o pool de conexões. Hoje só existem as tabelas de `organizations`; as de maior volume (projetos, tarefas) nascem nas specs 003–005.

## Alternativas consideradas

### A — Implementar o RLS agora (spec 006)

- Prós: defesa em profundidade desde cedo.
- Contras: toda leitura passa a exigir transação; o worker (retenção, outbox) precisa de papel e políticas próprios; custo de depuração; benefício pequeno com poucas tabelas tenant-scoped.

### B — Spike agora, implementação depois

- Prós: dados de latência antecipados.
- Contras: medição sobre um esquema que ainda vai mudar; o resultado fica obsoleto.

### C — Adiar RLS e spike para a Fase 4, reforçando os controles da aplicação

- Prós: foco no MVP; medição sobre o esquema real.
- Contras: risco residual de filtro esquecido até a Fase 4.

## Decisão

Adotamos **C** (decisão do usuário na spec 006).

1. Até a Fase 4, o isolamento depende dos controles do ADR 0004 reforçados pela spec 006: repositórios exigem `organizationId` em leitura e escrita; harness de isolamento obrigatório (casos gerados para toda rota tenant-scoped, casos por referência com ids reais de outra organização, snapshot de todas as tabelas com `organization_id`, ids canário) e teste que falha se uma rota do escopo do tenant não tiver caso ou se uma rota com `:organizationId` ficar fora dele; lint que restringe a leitura de `params.organizationId`.
2. **Gatilhos de reavaliação antecipada**: primeiro SQL raw tenant-scoped; busca, relatórios ou exportação; worker processando dados de tenant; Socket.IO; integrações externas; qualquer incidente ou quase-incidente de isolamento.
3. **Preparação barata, já**: `organization_id NOT NULL` em toda tabela filha (sem depender de joins); FKs compostas `(organization_id, id)`; `PrismaTransactionRunner` como ponto único de acesso; papel de banco da aplicação sem superuser nem `BYPASSRLS`, separado do papel de migrations, quando houver ambiente compartilhado.
4. **Risco residual aceito**: um filtro esquecido em repositório vazaria dados; mitigado pelo harness, pelo lint e por `/security-audit` em cada spec.

## Consequências

- **Positivas**: sem custo transversal agora; decisão final tomada sobre o esquema completo do MVP.
- **Negativas / custos**: risco residual de erro humano em queries (mitigado, não eliminado).
- **Riscos e mitigação**: query sem `organizationId` (assinaturas obrigam o parâmetro; harness A/B); rota nova sem caso de isolamento (teste de cobertura da tabela de rotas).
- **Como verificar**: `pnpm test:integration` (harness) e o teste unitário de cobertura de rotas em `apps/api`; `/security-audit` por spec; item da Fase 4 no roadmap apontando para este ADR.

## Referências

- PostgreSQL — Row Security Policies; Prisma 7 com driver adapters (transações interativas)
- ADR 0004, spec 006
