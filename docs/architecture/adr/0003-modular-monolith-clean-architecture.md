# 0003 — Modular monolith com Clean Architecture e bibliotecas por contexto e camada

- **Status**: Aceito
- **Data**: 2026-10-08
- **Relacionados**: [overview](../overview.md), [dependency-rules](../dependency-rules.md), [bounded-contexts](../bounded-contexts.md)

## Contexto

O TaskFlow tem regras de negócio reais (BR-001…BR-010) distribuídas em ~10 bounded contexts, uma equipe pequena e restrição explícita contra microsserviços e Kubernetes. É preciso limitar acoplamento sem custo operacional distribuído, e os limites precisam ser **verificáveis**, não apenas convenção.

## Alternativas consideradas

### A — Monólito em camadas único (`controllers/`, `services/`, `repositories/`)

- Prós: simples no início.
- Contras: contextos se misturam; nada impede um serviço de acessar tabelas de outro; regras vazam para controllers.

### B — Microsserviços por contexto

- Prós: isolamento forte.
- Contras: proibido pelo escopo; custo operacional e de consistência desproporcional.

### C — Um projeto Nx por contexto, com pastas de camada internas

- Prós: menos projetos.
- Contras: o Nx não verifica dependências entre pastas do mesmo projeto; regra de dependência vira convenção.

### D — Projetos Nx por contexto **e** camada, com tags e `enforce-module-boundaries`

- Prós: limites de contexto e de camada verificados no lint; testes e cache por biblioteca; extração futura facilitada.
- Contras: mais bibliotecas (até 4 por contexto) e boilerplate de configuração.

## Decisão

Adotamos **D**. Cada contexto terá bibliotecas `domain`, `application`, `infrastructure` e `http`, criadas somente quando houver código para elas. Tags `scope/domain/type` e restrições estão em `eslint.config.mjs`. Contextos não se importam; integração por portas ligadas no composition root. Composição de dependências manual (constructor injection) — sem container de DI. CQRS completo e Event Sourcing ficam fora.

## Consequências

- **Positivas**: arquitetura verificável pelo CI; domínio testável sem infraestrutura; boa legibilidade para avaliação técnica.
- **Negativas**: mais arquivos de configuração por contexto; risco de cerimônia — mitigado pela skill `/create-domain-module` e pela regra "crie apenas camadas com código".
- **Exceção conhecida**: Tasks e Boards compartilham uma fronteira transacional na movimentação de cards (documentada na spec 005).
- **Como verificar**: `pnpm lint` falha em violação de limites; `/review-code` verifica regras intra-projeto.
