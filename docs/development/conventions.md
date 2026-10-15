# Convenções

Resumo humano das convenções. As regras aplicadas pelos agentes estão em `.claude/rules/` e são a referência normativa.

## Idioma

| Item                                                                                       | Idioma                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Código: classes, métodos, variáveis, tipos, arquivos, endpoints, tabelas, colunas, eventos | Inglês                                     |
| Comentários, documentação, ADRs, specs                                                     | Português brasileiro                       |
| Textos de interface e mensagens ao usuário                                                 | Português brasileiro (preparado para i18n) |
| Commits                                                                                    | Inglês, Conventional Commits               |

## Nomenclatura

| Elemento            | Padrão                                | Exemplo                                                                    |
| ------------------- | ------------------------------------- | -------------------------------------------------------------------------- |
| Arquivos            | kebab-case + papel                    | `complete-task.use-case.ts`, `task.entity.ts`, `prisma-task.repository.ts` |
| Classes / tipos     | PascalCase                            | `CompleteTaskUseCase`, `TaskRepository`                                    |
| Variáveis / funções | camelCase, sem abreviações            | `organizationId`, `findOpenTasksByProject`                                 |
| Booleanos           | prefixo `is/has/can/should`           | `isRequired`, `hasPendingSubtasks`                                         |
| Tabelas / colunas   | snake_case plural / snake_case        | `tasks`, `organization_id`                                                 |
| Endpoints           | plural, kebab-case                    | `/api/v1/projects/{projectId}/tasks`                                       |
| Eventos de domínio  | passado, PascalCase                   | `TaskCompleted`                                                            |
| Códigos de erro     | UPPER_SNAKE_CASE                      | `VERSION_CONFLICT`                                                         |
| Seletores Angular   | prefixo `tf-`                         | `tf-task-card`                                                             |
| Bibliotecas Nx      | `backend-<context>-<layer>`           | `backend-tasks-domain`                                                     |
| Import paths        | `@taskflow/<scope>/<context>/<layer>` | `@taskflow/backend/tasks/domain`                                           |

## Qualidade

- TypeScript strict, sem `any`, sem casts inseguros, sem erros engolidos.
- Funções pequenas; classes com uma razão para mudar.
- Sem implementação fictícia: o que não está pronto é marcado como pendente (e não exportado como se funcionasse).
- Sem segredos no repositório; configuração via ambiente validado.
- Sem código sem spec aprovada para funcionalidades relevantes.

## Formatação e lint

- Prettier (`singleQuote`, `printWidth: 100`); o hook do Claude Code formata arquivos editados; `pnpm format:check` no CI.
- ESLint flat config com `@nx/enforce-module-boundaries`, `typescript-eslint` e `angular-eslint`.

## Commits

```
<type>(<scope>): <summary in imperative, lowercase>

<corpo opcional: por quê; Spec: specs/NNN-x, task Tn>
```

Tipos: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`, `build`. Escopos: nome do contexto (`tasks`, `identity`), `web`, `api`, `infra`, `deps`, `claude`.
