---
name: create-adr
description: Registra uma decisão arquitetural do TaskFlow como Architecture Decision Record numerado em docs/architecture/adr, com contexto, alternativas, decisão e consequências. Use quando uma decisão afeta estrutura, tecnologia, segurança, dados ou processo e não é trivialmente reversível, ou quando uma decisão aceita precisa ser substituída.
argument-hint: '<título da decisão>'
---

# Criar ADR

Decisão: $ARGUMENTS

1. Liste `docs/architecture/adr/` e use o próximo número livre com 4 dígitos. Nome: `NNNN-titulo-em-kebab-case.md` (título do arquivo em inglês, conteúdo em pt-BR).
2. Verifique se algum ADR existente trata do tema. Se a nova decisão o contradiz, o novo ADR **substitui** o antigo: marque o antigo como `Substituído por NNNN` (única edição permitida em ADR aceito).
3. Preencha a partir de `docs/architecture/adr/0000-template.md`:
   - **Status**: Proposto (padrão) — só vira Aceito com aprovação do usuário.
   - **Contexto**: problema, forças e restrições concretas do TaskFlow.
   - **Alternativas**: ao menos duas, com prós e contras honestos.
   - **Decisão**: o que foi escolhido, em voz ativa.
   - **Consequências**: positivas, negativas, riscos e como verificar (testes, lint, métricas).
   - **Referências**: specs, docs, links oficiais.
4. Adicione o ADR ao índice em `docs/architecture/adr/README.md`.
5. Se a decisão muda regras permanentes, atualize a regra correspondente em `.claude/rules/` e referências no `CLAUDE.md`.

Para decisões complexas, peça parecer ao agente `software-architect` antes de redigir.
