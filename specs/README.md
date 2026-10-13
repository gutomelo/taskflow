# Especificações (Spec-Driven Development)

Toda funcionalidade relevante do TaskFlow nasce aqui, antes do código.

## Estrutura

```text
specs/
├── templates/               # modelos dos quatro documentos
└── NNN-nome-da-feature/
    ├── requirements.md      # o quê e por quê (template: feature-spec.md)
    ├── design.md            # como (template: technical-plan.md)
    ├── tasks.md             # em que ordem, verificável
    └── acceptance.md        # como sabemos que terminou
```

## Ciclo de vida

| Status           | Significado                                                                   |
| ---------------- | ----------------------------------------------------------------------------- |
| Rascunho         | Em escrita; pode conter perguntas abertas.                                    |
| Em revisão       | Completo; aguardando revisão de arquitetura/segurança e aprovação do usuário. |
| Aprovado         | Pode ser implementado. Mudanças de escopo exigem revisão do documento.        |
| Em implementação | Ao menos uma tarefa iniciada.                                                 |
| Concluído        | Critérios de aceitação validados com evidência.                               |

O status fica no topo de `requirements.md` e `design.md`.

## Fluxo obrigatório

1. Entender a necessidade e o contexto (visão, roadmap, bounded contexts).
2. Escrever `requirements.md` — perguntas de produto vão ao usuário, nunca são inventadas.
3. Revisar consistência (com BRs, ADRs e outras specs).
4. Escrever `design.md`.
5. Revisar arquitetura e segurança (agentes `software-architect` e `security-reviewer`).
6. Escrever `tasks.md` e `acceptance.md`.
7. Aprovar os pontos de decisão com o usuário → status **Aprovado**; registrar ADRs.
8. Implementar incrementalmente (`/implement-spec`), uma tarefa por vez.
9. Executar testes e `pnpm verify`.
10. Revisar código (`/review-code`, `/security-audit` quando aplicável).
11. Validar aceitação com evidências.
12. Atualizar documentação, roadmap e este índice.

Proporcionalidade: correções triviais não exigem spec; melhorias pequenas viram tarefas em uma spec existente (ver [workflow](../docs/development/workflow.md)).

## Índice

| Spec                                                     | Fase | Status                                  |
| -------------------------------------------------------- | ---- | --------------------------------------- |
| [000-foundation](000-foundation/requirements.md)         | 0    | Concluído                               |
| [001-authentication](001-authentication/requirements.md) | 1    | Concluído                               |
| [002-organizations](002-organizations/requirements.md)   | 1    | Concluída                               |
| [003-projects](003-projects/requirements.md)             | 1    | Em especificação — aguardando aprovação |
| 004-tasks                                                | 1    | Não iniciada                            |
| 005-kanban                                               | 1    | Não iniciada                            |
| [006-permissions](006-permissions/requirements.md)       | 1    | Concluída                               |
| 007-sprints                                              | 3    | Não iniciada                            |
| 008-notifications                                        | 2    | Não iniciada                            |
| 009-analytics                                            | 3    | Não iniciada                            |

Diretórios de specs são criados quando a especificação começa — sem pastas vazias.
