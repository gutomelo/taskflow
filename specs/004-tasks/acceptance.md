# 004 — Tarefas · Aceitação

## Cenários

### CA-01 — Criar tarefas e numeração (BR-028)

```gherkin
Dado o projeto WEB ativo
Quando um manager e um member criam tarefas
Então elas nascem no primeiro status de categoria todo, com prioridade "sem", numeradas WEB-1, WEB-2…
E um viewer recebe 403
E vinte criações simultâneas recebem números distintos
E depois de excluir WEB-2 a próxima tarefa é WEB-21, nunca WEB-2
```

### CA-02 — Subtarefas e BR-001

```gherkin
Dado a tarefa WEB-1 com a subtarefa obrigatória WEB-2 pendente e a opcional WEB-3 pendente
Quando alguém tenta concluir WEB-1
Então recebe 422 TASK_HAS_PENDING_REQUIRED_SUBTASKS com o id de WEB-2 (WEB-3 não bloqueia)
Quando WEB-2 é cancelada
Então WEB-1 pode ser concluída
E criar subtarefa de WEB-2 (segundo nível) ou com pai de outro projeto é recusado
E, com WEB-1 concluída, criar subtarefa obrigatória, tornar WEB-3 obrigatória ou reabrir WEB-2 responde 422 PARENT_TASK_COMPLETED (D1)
E concluir o pai enquanto alguém cria uma subtarefa obrigatória nunca deixa o pai concluído com pendência
```

### CA-03 — Transições (BR-004)

```gherkin
Dado o workflow padrão
Quando alguém move de "A fazer" direto para "Concluído"
Então recebe 422 TRANSITION_NOT_ALLOWED
E "A fazer" → "Em andamento" → "Concluído" funciona, registra completedAt, e voltar para "Em andamento" o limpa
E o detalhe traz em actions.transitionTo só os destinos permitidos
```

### CA-04 — Dependências (BR-006)

```gherkin
Dado WEB-5 bloqueada por WEB-6 pendente
Quando alguém conclui WEB-5
Então recebe 422 TASK_BLOCKED_BY_DEPENDENCIES com o id de WEB-6
E com WEB-6 concluída ou cancelada, WEB-5 conclui
E WEB-6 bloqueada por WEB-5 é recusada com 422 DEPENDENCY_CYCLE, inclusive quando as duas são criadas em paralelo
E uma subtarefa obrigatória não pode ser bloqueada (direta ou indiretamente) pelo próprio pai (D4)
E bloqueadora de outro projeto responde 404
```

### CA-05 — Responsável (BR-003)

```gherkin
Dado o projeto WEB
Quando alguém atribui uma tarefa a um participante member, a um owner não participante ou a um viewer
Então os dois primeiros são aceitos e o viewer recebe 422 ASSIGNEE_NOT_PROJECT_MEMBER
E a mesma resposta vale para um usuário inexistente ou de outra organização
Quando a pessoa atribuída deixa de contribuir por qualquer caminho de RF-11
Então suas atribuições naquele projeto são desfeitas na mesma transação, e as de outra organização ficam intactas
E um admin com participação antiga viewer rebaixado a member perde as atribuições daquele projeto
E um admin com participação antiga que sai dela mantém as atribuições
E remover ou sair da organização com tarefas atribuídas responde 204
E atribuir enquanto a pessoa é rebaixada nunca deixa um leitor como responsável
```

### CA-06 — Cancelar, reabrir e excluir (BR-029)

```gherkin
Dado WEB-7 criada por Bia (member)
Quando WEB-7 é cancelada
Então sai da lista padrão, aparece com canceled=true, e editar responde 409 TASK_CANCELED até reabrir
Quando Bia exclui WEB-7 sem subtarefas de outras pessoas
Então recebe 204, e subtarefas e dependências somem
E Bia excluindo tarefa de outra pessoa, ou com subtarefa de outra pessoa, recebe 403 (D5); um manager exclui
```

### CA-07 — Lista e detalhe

```gherkin
Dado 30 tarefas com status, prioridades e responsáveis variados
Quando alguém lista com filtros (status, responsável, "eu", "sem responsável", prioridade, canceladas)
Então recebe páginas de 25 por número decrescente, com número fixo de consultas
E o detalhe por id e por WEB-N traz subtarefas, bloqueadoras, bloqueadas (até 50), transições e ações
```

### CA-08 — Projeto arquivado

```gherkin
Dado o projeto arquivado
Quando alguém tenta criar, editar, atribuir, mover, cancelar, excluir ou ligar tarefas
Então recebe 409 PROJECT_ARCHIVED, e a leitura continua
E arquivar enquanto alguém cria uma tarefa nunca deixa tarefa nova num projeto já arquivado
```

### CA-09 — Isolamento e autorização

```gherkin
Dado as organizações A e B e um usuário membro das duas
Quando as rotas de tarefa são chamadas sob o prefixo de A com ids, chaves e cursores de B (caminho, query ou corpo)
Então respondem 404 com o código esperado, sem ids de B nas respostas e com o banco de B intacto
E quem não participa do projeto recebe o mesmo corpo de "tarefa inexistente" em toda rota por tarefa
E participante sem permissão recebe 403 antes de qualquer erro de estado
E pai, bloqueadora, status ou filtros de outro projeto da mesma organização respondem 404 ou lista vazia
```

### CA-10 — Interface e jornada

```gherkin
Dado um projeto com um participante member
Quando o manager cria uma tarefa, atribui ao member e cria uma subtarefa obrigatória
E tenta concluir o pai
Então vê a mensagem com a subtarefa pendente
Quando conclui a subtarefa e depois o pai
Então o pai aparece concluído
E as ações aparecem só com capacidade da API
```

## Testes obrigatórios

- [ ] Domínio: BR-001, BR-004, BR-006 (com D4), BR-028, BR-029, ações
- [ ] Casos de uso com fakes: sucesso, 403/404, regras, ordem de decisão
- [ ] Integração: restrições do banco (incluindo o catálogo do `SET NULL`), portas na mesma transação, concorrência, caminhos de RF-11, harness e bateria de tarefas
- [ ] HTTP: contratos, 400/403/404/409/422/429, OpenAPI
- [ ] Frontend: lista, criação, detalhe
- [ ] E2E: jornada real de tarefas; jornadas existentes verdes

## Evidências de validação

| Critério | Evidência (comando + resultado) | Data |
| -------- | ------------------------------- | ---- |

## Definição de concluído

- [ ] CA-01 a CA-10 comprovados por testes executados
- [ ] `pnpm verify`, `pnpm test:integration` e E2E passando
- [ ] `/review-code` sem bloqueantes e `/security-audit` sem Críticos/Altos abertos
- [ ] Documentação, regras de negócio, design da 003 e roadmap atualizados
