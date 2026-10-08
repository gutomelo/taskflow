---
name: create-feature
description: Conduz uma funcionalidade nova do TaskFlow do pedido até a entrega seguindo SDD — cria a spec (requirements, design, tasks, acceptance) a partir dos templates, coleta aprovação e só então implementa ponta a ponta. Use quando o usuário pedir uma funcionalidade nova relevante.
argument-hint: "<descrição da funcionalidade>"
disable-model-invocation: true
---

# Criar funcionalidade (fluxo SDD completo)

Pedido: $ARGUMENTS

## Fase A — Especificar (sem código)

1. **Entender**: leia `docs/product/vision.md`, `docs/product/roadmap.md`, `docs/architecture/bounded-contexts.md`. Confirme que a funcionalidade pertence à fase atual; se for de fase futura, avise.
2. **Identificar o bounded context** e os contextos vizinhos afetados.
3. **Regras de negócio**: mapeie BR-xxx existentes em `docs/product/business-rules.md`; proponha novas com ID sequencial.
4. Crie `specs/NNN-<nome>/requirements.md` a partir de `specs/templates/feature-spec.md`. Pergunte ao usuário o que for decisão de produto — não invente requisitos.
5. **Revisar consistência**: requisitos testáveis, sem contradição com BRs/ADRs.
6. Crie `design.md` a partir de `specs/templates/technical-plan.md`: contratos (endpoints, eventos), modelagem, segurança, concorrência, alternativas.
7. **Revisão de arquitetura e segurança**: para designs não triviais, consulte os agentes `software-architect` e `security-reviewer` (em paralelo) e incorpore os achados.
8. Crie `tasks.md` (template `specs/templates/tasks.md`) com tarefas pequenas, ordenadas por dependência, cada uma verificável.
9. Crie `acceptance.md` (template `specs/templates/acceptance.md`) com cenários Given/When/Then.
10. **Apresente os pontos de decisão** e aguarde aprovação explícita. Ao aprovar, mude o status para **Aprovado** e registre ADRs necessários (`/create-adr`).

## Fase B — Implementar

Execute `/implement-spec specs/NNN-<nome>` tarefa a tarefa: domínio → casos de uso → persistência → API → frontend → verificações → documentação.

## Fase C — Validar

- Todos os cenários de `acceptance.md` comprovados por testes executados.
- `pnpm verify` passando; `/review-code` e, se tocar auth/tenancy, `/security-audit`.
- Atualize `specs/README.md` (status) e `docs/product/roadmap.md`.

Proporcionalidade: funcionalidade pequena pode ter documentos curtos, mas as quatro perguntas (o quê, como, em que ordem, como sei que terminou) precisam de resposta.
