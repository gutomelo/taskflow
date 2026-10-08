# 0010 — Tailwind CSS e Angular Material com tokens compartilhados

- **Status**: Aceito
- **Data**: 2026-10-08
- **Relacionados**: [design-system](../../design-system.md)

## Contexto

O brief pede Tailwind para layout/utilitários e Angular Material/CDK para componentes complexos e acessíveis, sem conflito de estilos e com dark mode planejado. Tailwind 4 não é compatível com pré-processadores (Sass), enquanto o tema do Material 3 é configurado via Sass (`mat.theme`).

## Alternativas consideradas

### A — Um único stylesheet SCSS com Tailwind e Material

- Contras: Tailwind 4 não deve passar pelo Sass. Rejeitada.

### B — Somente Tailwind, sem Material

- Contras: perde comportamento acessível pronto (dialogs, menus, datepicker, CDK drag-and-drop continua disponível, mas sem componentes).

### C — Dois stylesheets globais e tokens CSS como fonte única

- Prós: cada ferramenta processada pelo seu pipeline; cores definidas uma vez em CSS custom properties.
- Contras: dois arquivos para manter; cuidado com especificidade.

## Decisão

Adotamos **C**:

1. `styles/tokens.css`: tokens `--tf-*` (claro e escuro via `[data-theme='dark']` e `prefers-color-scheme`).
2. `styles/material-theme.scss`: `mat.theme(...)` com tipografia Inter e `$overrides` apontando os system tokens do Material (`primary`, `surface`, `error`…) para `var(--tf-*)`.
3. `styles/tailwind.css`: `@import "tailwindcss"` + `@theme inline` mapeando utilitários (`bg-primary`, `text-muted`…) para `var(--tf-*)`; `@custom-variant dark` ligado ao atributo `data-theme`.
4. Material não é sobrescrito via seletores internos (`.mat-mdc-*`); apenas pelas APIs de tema.
5. Preflight do Tailwind permanece ativo; Material é carregado depois para manter seus estilos de componente.

## Consequências

- **Positivas**: uma fonte de verdade de cores; dark mode por troca de atributo; nenhum conflito de pipeline.
- **Negativas**: dois arquivos globais; necessidade de validar contraste dos tokens nos dois temas.
- **Como verificar**: build do Angular; revisão visual/acessibilidade com o agente `ux-ui-specialist`.
