# 0001 — Registrar decisões arquiteturais com ADRs

- **Status**: Aceito
- **Data**: 2026-10-08
- **Relacionados**: [create-adr](../../../.claude/skills/create-adr/SKILL.md)

## Contexto

O TaskFlow é desenvolvido com apoio intenso de agentes de IA ao longo de várias sessões. Sem registro explícito, decisões se perdem entre sessões, são revertidas silenciosamente ou reabertas sem novos fatos. Avaliadores técnicos também precisam entender o porquê das escolhas.

## Alternativas consideradas

### A — Decisões apenas em PRs e commits

- Prós: zero overhead.
- Contras: difícil de localizar; agentes não carregam histórico de PRs como contexto.

### B — ADRs curtos versionados no repositório

- Prós: legíveis por humanos e agentes; numerados e imutáveis; rastreáveis.
- Contras: exigem disciplina para criar e manter o índice.

## Decisão

Adotamos ADRs em `docs/architecture/adr/`, numerados com 4 dígitos, em português, seguindo `0000-template.md`. ADR aceito não é editado em substância: uma nova decisão o substitui e o antigo recebe o status "Substituído por". Agentes não alteram decisões aceitas sem novo ADR (regra em `CLAUDE.md`).

## Consequências

- **Positivas**: memória arquitetural durável; contexto direto para agentes e revisores.
- **Negativas**: custo de escrita — mitigado pela skill `/create-adr` e por aplicar ADR apenas a decisões não triviais.
- **Como verificar**: revisão de PR (`/review-code`) aponta decisões estruturais sem ADR.
