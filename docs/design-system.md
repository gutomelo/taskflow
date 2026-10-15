# Design System — TaskFlow

Status: **tokens, tema e tipografia implementados** na Fase 0 (`apps/web/src/styles/`). Componentes de produto são **planejados** e entram com as specs de cada tela.

Arquitetura de estilos: ADR [0010](architecture/adr/0010-tailwind-and-angular-material.md).

## Princípios

1. **Clareza antes de decoração** — hierarquia por tipografia e espaço, não por cor.
2. **Densidade produtiva** — listas e quadros mostram muita informação sem parecer apertados.
3. **Feedback imediato** — toda ação tem resposta visível em < 100 ms (estado de carregamento, otimismo com rollback).
4. **Acessível por padrão** — WCAG 2.2 AA; cor nunca é o único portador de significado.
5. **Identidade própria** — referências conceituais (Linear, Jira, ClickUp, Trello), sem copiar layouts, ícones ou marcas.

## Tokens de cor

Fonte única: `apps/web/src/styles/tokens.css` (`--tf-*`). Tailwind e Angular Material consomem os mesmos tokens.

### Modo claro

| Token                      | Valor     | Uso                                            |
| -------------------------- | --------- | ---------------------------------------------- |
| `--tf-color-primary`       | `#4F46E5` | Ações primárias, links, foco                   |
| `--tf-color-primary-hover` | `#4338CA` | Hover/pressed de primária                      |
| `--tf-color-on-primary`    | `#FFFFFF` | Texto sobre primária                           |
| `--tf-color-background`    | `#F8FAFC` | Fundo da aplicação                             |
| `--tf-color-surface`       | `#FFFFFF` | Cards, painéis, diálogos                       |
| `--tf-color-sidebar`       | `#111827` | Navegação lateral                              |
| `--tf-color-on-sidebar`    | `#E2E8F0` | Texto na sidebar                               |
| `--tf-color-text`          | `#0F172A` | Texto principal                                |
| `--tf-color-text-muted`    | `#64748B` | Texto secundário                               |
| `--tf-color-border`        | `#E2E8F0` | Divisores decorativos                          |
| `--tf-color-border-strong` | `#64748B` | Bordas de campos e controles (precisam de 3:1) |

### Semânticas

Cada cor semântica tem um valor de **indicador** (preenchimentos, ícones grandes, barras, pontos com rótulo) e um valor **-text** para texto e ícones pequenos.

| Semântica | Indicador | Texto acessível | Contraste do texto em `#FFF` |
| --------- | --------- | --------------- | ---------------------------- |
| Success   | `#16A34A` | `#15803D`       | 5.02:1                       |
| Warning   | `#F59E0B` | `#B45309`       | 5.02:1                       |
| Error     | `#DC2626` | `#DC2626`       | 4.83:1                       |
| Info      | `#0284C7` | `#0369A1`       | 5.93:1                       |

### Prioridade de tarefas

| Prioridade | Indicador | Texto acessível |
| ---------- | --------- | --------------- |
| Critical   | `#DC2626` | `#DC2626`       |
| High       | `#F97316` | `#C2410C`       |
| Medium     | `#F59E0B` | `#B45309`       |
| Low        | `#22C55E` | `#15803D`       |

Prioridade é sempre exibida com **ícone + rótulo** (ex.: "Alta"), nunca apenas cor.

### Modo escuro (planejado na arquitetura, tokens já definidos)

Ativado por `[data-theme='dark']` no `<html>` ou, sem preferência explícita, por `prefers-color-scheme: dark`.

| Token                           | Valor                                                                 |
| ------------------------------- | --------------------------------------------------------------------- |
| `--tf-color-primary`            | `#818CF8` (texto sobre ele: `#0F172A`)                                |
| `--tf-color-background`         | `#0B1120`                                                             |
| `--tf-color-surface`            | `#111827`                                                             |
| `--tf-color-sidebar`            | `#020617`                                                             |
| `--tf-color-text` / `-muted`    | `#F1F5F9` / `#94A3B8`                                                 |
| `--tf-color-border` / `-strong` | `#334155` / `#64748B`                                                 |
| Semânticas (texto e indicador)  | Success `#4ADE80`, Warning `#FBBF24`, Error `#F87171`, Info `#38BDF8` |

## Verificação de contraste (WCAG 2.x, calculada)

| Par                                                               | Razão              | Resultado                                     |
| ----------------------------------------------------------------- | ------------------ | --------------------------------------------- |
| Primary sobre Surface / branco sobre Primary                      | 6.29               | AA texto ✅                                   |
| Branco sobre Primary Hover                                        | 7.90               | AAA ✅                                        |
| Text sobre Background                                             | 17.06              | AAA ✅                                        |
| Text Muted sobre Surface / Background                             | 4.76 / 4.55        | AA texto ✅ (limite)                          |
| Border (`#E2E8F0`) sobre Surface                                  | 1.23               | Apenas decorativo — **não** usar em controles |
| Border Strong (`#64748B`) sobre Surface                           | 4.76               | Controles ✅                                  |
| Success `#16A34A` / Warning `#F59E0B` / Info `#0284C7` como texto | 3.30 / 2.15 / 4.10 | ❌ texto → usar variantes `-text`             |
| High `#F97316` / Low `#22C55E` como texto                         | 2.80 / 2.28        | ❌ texto → usar variantes `-text`             |
| Dark: Text Muted sobre Surface                                    | 6.92               | ✅                                            |
| Dark: Primary sobre Surface                                       | 5.95               | ✅                                            |
| Dark: Border Strong sobre Surface                                 | 3.73               | Controles ✅                                  |

Ao propor um token novo, calcule e registre o contraste nesta tabela.

## Tipografia

- Família: **Inter** (SIL Open Font License 1.1 — uso livre), **auto-hospedada** pelo pacote `@fontsource-variable/inter` (fonte variável, eixo de peso; `font-family: 'Inter Variable'`; `display: swap`; o navegador só baixa os subconjuntos usados via `unicode-range`); fallback `system-ui`. Sem Google Fonts: a CSP do SPA não admite origens de terceiros (spec 001, T23).
- Escala (rem): `0.75` legenda · `0.875` corpo compacto (listas, cards) · `1` corpo · `1.125` subtítulo · `1.25` título de seção · `1.5` título de página · `1.875` destaque.
- Pesos: 400 corpo, 500 rótulos/botões, 600 títulos. Números tabulares (`font-variant-numeric: tabular-nums`) em métricas.

## Espaçamento, forma e elevação

- Escala de espaçamento do Tailwind (base 4 px). Padding de card: 16 px; gap de colunas Kanban: 16 px; densidade compacta em listas: 8 px vertical.
- Raio: `--tf-radius-sm` 6 px (inputs, badges) · `--tf-radius-md` 8 px (cards, botões) · `--tf-radius-lg` 12 px (diálogos, painéis).
- Sombras discretas: `--tf-shadow-sm` para cards em repouso, `--tf-shadow-md` para arraste/hover, `--tf-shadow-lg` para diálogos.

## Movimento

- Durações: 120 ms (hover/foco), 200 ms (entrada de elementos), 250 ms (painéis).
- `prefers-reduced-motion: reduce` desativa animações não essenciais (já tratado em `tokens.css`).

## Uso de Tailwind e Angular Material

| Use Tailwind para                                                         | Use Material/CDK para                                                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Layout (grid, flex), espaçamento, tipografia utilitária, cores via tokens | Diálogos, menus, selects, datepicker, snackbars (toasts), tooltips, tabelas complexas, drag-and-drop (CDK) |

- Classes de cor: `bg-surface`, `text-muted`, `border-default`, `bg-primary`, `text-success` etc. (mapeadas em `tailwind.css`).
- Nunca hex literal em componentes. Nunca sobrescrever `.mat-mdc-*`; personalizar com `mat.*-overrides`.

## Padrões de interface (para as specs de tela)

- **Layout**: sidebar escura colapsável (≥ 1024 px fixa; < 1024 px em drawer), topbar com seletor de organização, busca e menu do usuário; conteúdo com largura fluida.
- **Estados**: skeleton para carregamento > 300 ms; empty state com explicação e ação primária; erro com mensagem humana, `requestId` copiável e ação de tentar novamente; conflito de versão com opção "recarregar" e visualização do que mudou.
- **Feedback**: toasts (MatSnackBar) para confirmações transitórias com `aria-live="polite"`; erros de formulário inline.
- **Ações destrutivas**: diálogo de confirmação descrevendo a consequência; botão destrutivo em `error`.
- **Kanban**: cards com título, prioridade (ícone + rótulo), responsáveis (avatares com nome acessível), prazo (vermelho só com texto "atrasada"); drag-and-drop com CDK e alternativa por teclado (menu "Mover para…").
- **Foco**: anel visível de 2 px `--tf-color-focus-ring` com offset de 2 px em todos os elementos interativos.

## Telas principais (planejadas)

| Área          | Telas                                                                                                           | Spec                 |
| ------------- | --------------------------------------------------------------------------------------------------------------- | -------------------- |
| Autenticação  | Login, cadastro, recuperação de senha                                                                           | 001                  |
| Organização   | Seletor, membros, convites, equipes                                                                             | 002                  |
| Dashboard     | Resumo de projetos, minhas tarefas, atividades, prazos                                                          | 009 (parcial no MVP) |
| Projetos      | Lista, criação, detalhes, membros, configurações                                                                | 003                  |
| Tarefas       | Detalhes (descrição, responsáveis, status, prioridade, prazo, subtarefas, dependências, comentários, histórico) | 004                  |
| Kanban        | Colunas configuráveis, cards, filtros, busca, tempo real                                                        | 005                  |
| Sprints       | Backlog, planejamento, sprint atual, indicadores                                                                | 007                  |
| Configurações | Perfil, organização, equipes, segurança, notificações                                                           | 001/002/008          |

## Implementado na Fase 0

- `tokens.css`, `material-theme.scss`, `tailwind.css`; fonte Inter; tema claro/escuro por tokens.
- Shell mínimo (topbar com marca) e página de status do sistema demonstrando estados de carregamento, erro e sucesso.
