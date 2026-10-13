# 003 — Projetos · Aceitação

## Cenários

### CA-01 — Quem cria projetos

```gherkin
Dado uma organização com "membros podem criar projetos" ligada
Quando owner, admin e member criam projetos com chave e nome válidos
Então os três projetos são criados, o member criador participa como manager, owner e admin não são gravados como participantes (D1), e cada projeto tem os status "A fazer", "Em andamento" e "Concluído" com transições de ida e volta
E um viewer recebe 403
Quando a configuração é desligada
Então o member recebe 403 e owner/admin continuam criando
E um member criando enquanto outro usuário desliga a configuração nunca cria depois do desligamento confirmado
```

### CA-02 — Chave do projeto (BR-025)

```gherkin
Dado um projeto "WEB" (mesmo arquivado) na organização A
Quando alguém cria outro projeto "WEB" em A
Então a API responde 409 PROJECT_KEY_TAKEN
E "web", "1AB", "A" e "ABCDEFGHIJK" são recusados com 400
E "WEB" é aceito na organização B
E nenhum endpoint aceita alterar a chave
E um viewer da organização recebe 403, não PROJECT_KEY_TAKEN
```

### CA-03 — Visibilidade e respostas sem oráculo (BR-023)

```gherkin
Dado o projeto P1, do qual Bia (member da organização) não participa
Quando Bia lista projetos
Então P1 não aparece, e owner/admin o veem
Quando Bia chama qualquer rota de P1, por id ou por chave
Então recebe 404 PROJECT_NOT_FOUND com o mesmo corpo de um projeto inexistente
Dado Caio, viewer em P1
Quando Caio tenta adicionar um participante, mesmo com userId inexistente ou duplicado
Então recebe 403 antes de qualquer erro de estado
```

### CA-04 — Papel efetivo e capacidades

```gherkin
Dado Ana com participação manager em P1, rebaixada a viewer na organização
Quando Ana lê P1
Então myRole é viewer e capabilities contém só "project:read"
E um owner não participante lê P1 com myRole manager
```

### CA-05 — Editar, arquivar e restaurar (BR-008, BR-026)

```gherkin
Dado P1 ativo na versão 3
Quando um manager edita com a versão 2
Então recebe 409 VERSION_CONFLICT
Quando arquiva com a versão 3
Então P1 sai da lista padrão, aparece com status=archived e suas capacidades são só ler e restaurar
E editar ou adicionar participante responde 409 PROJECT_ARCHIVED
E remover um participante ou sair continuam permitidos
Quando arquiva de novo
Então recebe 200 com a versão atual, sem conflito
Quando restaura
Então volta a aceitar edições
```

### CA-06 — Adicionar participante (BR-027)

```gherkin
Dado um manager de P1
Quando adiciona um membro da organização como member
Então recebe 201 com as ações calculadas
Quando adiciona um userId que não é membro da organização (inexistente ou de outra organização)
Então recebe 404 MEMBER_NOT_FOUND idêntico nos dois casos
Quando adiciona um viewer da organização como manager ou member
Então recebe 422 PROJECT_ROLE_ABOVE_CEILING
Quando adiciona quem já participa
Então recebe 409 ALREADY_A_PROJECT_MEMBER
Quando adiciona um owner ou admin da organização
Então recebe 422 ALREADY_MANAGES_ALL_PROJECTS
E os candidatos listados excluem owner/admin e trazem só os papéis permitidos pelo teto
```

### CA-07 — Alterar papel, remover, sair e IDOR

```gherkin
Dado P1 e P2 na mesma organização, e Davi participante só de P2
Quando o manager de P1 altera o papel ou remove Davi em P1
Então recebe 404 PROJECT_MEMBER_NOT_FOUND e a participação de Davi em P2 fica intacta
Quando um participante de P1 sai
Então recebe 204, mesmo sendo o único manager
Quando um member de P1 tenta remover outro participante
Então recebe 403
```

### CA-08 — Organização propaga para projetos (BR-027)

```gherkin
Dado Eva, member da organização, manager em P1 e P2
Quando Eva é rebaixada a viewer na organização
Então suas participações viram viewer na mesma transação, com versão incrementada
E promovê-la de volta a member não restaura manager
Quando Eva é removida da organização (ou sai)
Então suas participações são apagadas na mesma transação
E reconvidada e aceita, ela não participa de nenhum projeto
E, com o rebaixamento e a promoção a manager em P1 disputando, o papel gravado nunca passa do teto
```

### CA-09 — Isolamento entre organizações

```gherkin
Dado as organizações A e B, cada uma com projeto, participantes e workflow
E um usuário que é member de A e participante de um projeto de B
Quando ele e o owner de A chamam as rotas de projeto sob o prefixo de A, trocando uma referência por vez por id ou chave de B (caminho, query ou corpo)
Então todas respondem 404 com o código esperado, nenhum id de B aparece nas respostas e o banco de B fica inalterado
E uma rota nova sem caso, ou com campo *Id no corpo sem variante, faz o teste falhar
```

### CA-10 — Interface e jornada

```gherkin
Dado um member com "membros podem criar projetos" ligada
Quando abre "Projetos" na organização
Então vê a lista (com estados de carregamento, vazio e erro) e o botão "Novo projeto"
Quando cria "Website" com a chave sugerida "WEB"
Então vai para /o/{slug}/projects/WEB com visão geral, configurações e participantes
E as ações (editar, arquivar, adicionar, alterar, remover) aparecem só com capacidade da API
E na jornada E2E real: criar projeto, adicionar participante, arquivar e restaurar
```

## Testes obrigatórios

- [x] Domínio: BR-025, BR-026, BR-027, capacidades, ações, workflow padrão
- [x] Casos de uso com fakes: sucesso, 403/404, erros de regra, ordem de decisão
- [x] Integração: restrições do banco, cascata, portas na mesma transação, concorrência, harness ampliado, bateria intra-tenant
- [x] HTTP: contratos, 400/403/404/409/422/429, OpenAPI
- [x] Frontend: lista, criação, área do projeto, ações por capacidade
- [x] E2E: jornada real de projetos; jornadas existentes verdes

## Evidências de validação

| Critério | Evidência (comando + resultado)                                                                                                                                                               | Data       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| CA-01    | `project.use-cases.spec.ts` (CreateProject: D1, member manager, workflow, BR-024); `projects-composition.integration.spec.ts` (configuração × criação); E2E `projects-journey` ✔              | 2026-10-13 |
| CA-02    | `project.spec.ts` (BR-025); `project.use-cases.spec.ts` (CA-02, 403 antes de chave em uso); `projects-schema.integration.spec.ts`; `projects-router.spec.ts` ✔                                | 2026-10-13 |
| CA-03    | `project.use-cases.spec.ts` (CA-03); `projects-authorization.integration.spec.ts` (404 idêntico em toda rota; 403 antes de erros de estado) ✔                                                 | 2026-10-13 |
| CA-04    | `project.use-cases.spec.ts` (CA-04); `project-policy.spec.ts` ✔                                                                                                                               | 2026-10-13 |
| CA-05    | `project.use-cases.spec.ts` (BR-026, idempotência, versão); `projects-router.spec.ts`; `project-settings.page.spec.ts`; E2E ✔                                                                 | 2026-10-13 |
| CA-06    | `project-member.use-cases.spec.ts` (CA-06); `projects-router.spec.ts`; `project-members.page.spec.ts` ✔                                                                                       | 2026-10-13 |
| CA-07    | `project-member.use-cases.spec.ts` (CA-07, IDOR); `projects-authorization.integration.spec.ts` (IDOR P1 × P2) ✔                                                                               | 2026-10-13 |
| CA-08    | `projects-composition.integration.spec.ts` (BR-027 rebaixar/promover, remover/reconvidar, CA-08 nas duas ordens); `apply-organization-role-change.use-case.spec.ts` ✔                         | 2026-10-13 |
| CA-09    | `organizations-isolation.integration.spec.ts` (22 rotas, ator duplo, códigos conferidos); `route-coverage.spec.ts` ✔                                                                          | 2026-10-13 |
| CA-10    | `projects-list.page.spec.ts`, `create-project.page.spec.ts`, `project-area.spec.ts`, `project-settings.page.spec.ts`, `project-members.page.spec.ts`; Playwright `projects-journey.spec.ts` ✔ | 2026-10-13 |
| Gate     | `pnpm verify` ✔ 66/66; `pnpm test:integration` ✔ 154; Playwright ✔ 19/19                                                                                                                      | 2026-10-13 |

## Definição de concluído

- [x] CA-01 a CA-10 comprovados por testes executados
- [x] `pnpm verify`, `pnpm test:integration` e E2E passando
- [x] `/review-code` sem bloqueantes e `/security-audit` sem Críticos/Altos abertos
- [x] ADR 0015 aceito; documentação e roadmap atualizados
