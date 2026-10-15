# 0013 — Vocabulário de autorização como Shared Kernel e papel efetivo com teto da organização

- **Status**: Aceito (2026-10-13, com a aprovação da spec 006)
- **Data**: 2026-10-13
- **Decisores**: usuário (product owner); arquitetura (Claude Code, revisão da spec 006)
- **Relacionados**: [spec 006](../../../specs/006-permissions/design.md), [ADR 0003](0003-modular-monolith-clean-architecture.md), [ADR 0012](0012-tenant-in-api-path.md), [autorização](../../security/authorization.md), [bounded contexts](../bounded-contexts.md)

## Contexto

A política de papéis da organização vivia em `organizations/domain` (spec 002), o frontend mantinha uma cópia manual (`role-policy.ts`, `ActiveOrganizationStore.canManage`) e a matriz de projeto existia só em documento. As specs 003–005 (projects, tasks, boards) precisam de papéis de projeto, de um papel efetivo que combine organização e projeto (BR-023) e da mesma matriz para decidir. `bounded-contexts.md` dizia que `identity` "expõe a política de autorização", o que contradiz a spec 002 e faria `identity` depender de dados de organização e projeto. As regras de dependência (ADR 0003) proíbem um contexto de importar outro.

## Alternativas consideradas

### A — Contexto `authorization` com biblioteca e portas próprias

- Prós: dono explícito.
- Contras: papéis são fixos e sem estado próprio; contexto vazio que só encaminha chamadas; mais portas e configuração.

### B — `identity` expõe a política

- Prós: alinhado ao texto antigo.
- Contras: `identity` passaria a conhecer organizações e projetos.

### C — Cada contexto mantém sua cópia da matriz

- Prós: autonomia.
- Contras: divergência garantida entre contextos e com o frontend.

### D — Shared Kernel em `libs/backend/shared/kernel` (dados e funções puras)

- Prós: uma fonte de verdade; as tags existentes (`scope:backend`, `domain:shared`, `type:domain`) já permitem o uso por todo contexto e camada; sem I/O, testável por tabela.
- Contras: mudança na matriz afeta vários contextos ao mesmo tempo; risco de o kernel acumular regra com estado.

## Decisão

Adotamos **D**.

1. `shared/kernel/authorization` contém somente: catálogos (`ORGANIZATION_PERMISSIONS`, `PROJECT_PERMISSIONS`), `PROJECT_ROLES`, guardas de runtime (`Object.hasOwn`), as matrizes como `Record` com tipo explícito e congelados (`allow`/`deny`/`setting` na organização; `allow`/`own`/`deny` no projeto) e `effectiveProjectRole`.
2. Regras que dependem de estado (último owner BR-019, alvo de BR-021, BR-003, projeto arquivado, lock) ficam no domínio e nos casos de uso do contexto dono. Um grant `allow` nunca é autorização completa.
3. A decisão final continua no caso de uso de cada contexto, com o estado relido na mesma transação. Os dados de que ela depende chegam por portas: `projects` lê `membersCanCreateProjects` por uma porta própria ligada no composition root; `tasks` e `boards` obtêm o papel de projeto por uma porta para `projects`.
4. Papel efetivo (BR-023): owner/admin da organização ⇒ `manager`; member ⇒ papel do projeto; viewer ⇒ no máximo `viewer`; sem participação ⇒ sem acesso (404). Calculado na leitura (teto = papel da organização). Para não haver privilégio adormecido, a spec 003 grava participações com FK composta para `memberships` em cascata, recusa papel de projeto acima do teto e propaga o rebaixamento a viewer.
5. O frontend não tem matriz: recebe capacidades e ações calculadas pela API (capacidade é dica; a API sempre decide).
6. Os catálogos são espelhados em `libs/contracts` (o kernel não pode importar contracts); um teste em `organizations/http` garante a paridade.

## Consequências

- **Positivas**: uma fonte de verdade para backend e interface; negação por padrão verificada pelo compilador e por testes com o esperado transcrito do documento; sem dependência entre contextos.
- **Negativas / custos**: mudar a matriz exige revisar `authorization.md` e a spec 006 e afeta vários contextos; catálogo duplicado em `contracts`, protegido por teste.
- **Riscos e mitigação**: kernel virar depósito de regra (só dados e funções puras; revisão); grant lido como autorização completa (documentado; casos de uso mantêm as checagens de estado); privilégio adormecido em participações de projeto (obrigações da spec 003).
- **Como verificar**: testes tabela-driven do kernel (incluindo chaves de protótipo); teste de paridade kernel × contracts; `pnpm lint` (boundaries); ausência de matriz em `apps/web`.

## Referências

- Evans, _Domain-Driven Design_ — Shared Kernel
- Specs 002 (BR-019, BR-021) e 006 (BR-023, BR-024)
