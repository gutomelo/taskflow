# 010 — Comentários e menções · Aceitação

## Cenários

### CA-01 — Conversa da tarefa

```gherkin
Dado a tarefa WEB-1 com comentários de Ana e Bia, um editado e um removido
Quando um participante abre a tarefa
Então vê os comentários em ordem cronológica, com autor, data, menções pelo nome atual e a marca "editado"
E o removido aparece como "Comentário removido", na mesma posição, sem texto nem menções
E a seção mostra o número de comentários não removidos
E um autor que saiu da organização aparece como "Ex-membro", sem nome
E cada comentário pode ser lido pelo seu id
E conversas longas carregam por página ("carregar anteriores"), com cursor que só vale para esta tarefa
E a subtarefa WEB-2 tem a sua própria conversa
```

### CA-02 — Comentar (BR-031)

```gherkin
Dado um member e um viewer participantes do projeto
Quando o member envia "Pode revisar?\nObrigado"
Então o comentário é criado com as quebras de linha preservadas e aparece no fim da conversa
Quando o viewer tenta comentar
Então recebe 403
E texto vazio, só com espaços, com caracteres de controle, com formatação bidi, com Unicode malformado ou acima do limite responde 400 INVALID_COMMENT_BODY
```

### CA-03 — Menções (BR-032)

```gherkin
Dado Bia (member), Vivi (viewer) e o owner da organização, que leem o projeto, e Otto, membro da organização sem acesso ao projeto
Quando Ana comenta mencionando Bia duas vezes e Vivi
Então o comentário tem duas menções (Bia e Vivi), exibidas com o nome atual, e o token fica na forma canônica
E Ana mencionando a si mesma não vira menção
E o evento comment_created traz as duas, só com ids
Quando Ana menciona Otto, ou um usuário de outra organização, ou um id inexistente
Então recebe 422 INVALID_MENTION com o mesmo corpo nos três casos, e nada é gravado
E mais de 20 pessoas distintas respondem 422 TOO_MANY_MENTIONS
E a sugestão de menções lista só quem lê o projeto, sem Ana, filtrando por nome ou e-mail, e o viewer recebe 403 nela
```

### CA-04 — Editar (BR-008, BR-031, BR-032)

```gherkin
Dado o comentário de Ana mencionando Bia
Quando Ana edita para mencionar Bia e o owner, com a versão atual
Então o texto muda, aparece "editado", as menções são Bia e o owner, e o evento traz só o owner como nova
Quando Bia tenta editar o comentário de Ana
Então recebe 403
E com a versão desatualizada Ana recebe 409 VERSION_CONFLICT
E editar um comentário removido responde 409 COMMENT_DELETED
Dado que Bia perdeu o acesso ao projeto depois de mencionada
Quando Ana corrige o texto mantendo a menção a Bia
Então a edição é aceita e a menção a Bia continua
```

### CA-05 — Excluir e moderar

```gherkin
Dado comentários de Ana (member) e de Bia (member) e um manager
Quando Ana exclui o próprio comentário
Então ele vira "Comentário removido" e suas menções somem
E excluir de novo responde 204 sem mudar nada
Quando Ana tenta excluir o comentário de Bia
Então recebe 403
Quando o manager exclui o comentário de Bia
Então ele vira "Comentário removido" e o evento indica moderação
```

### CA-06 — Estados e papel

```gherkin
Dado o projeto arquivado
Então ler e excluir funcionam, e comentar e editar respondem 409 PROJECT_ARCHIVED, depois do 403
Dado a tarefa cancelada
Então ler e excluir funcionam (inclusive a moderação do manager), e comentar e editar respondem 409 TASK_CANCELED; ao reabrir, volta a aceitar
Dado Ana rebaixada a viewer no projeto
Então Ana não edita nem exclui os próprios comentários (403)
```

### CA-07 — Concorrência e exclusão

```gherkin
Dado alguém comentando na tarefa WEB-1
Quando a tarefa é cancelada ao mesmo tempo
Então o comentário entra antes do cancelamento ou é recusado com 409 TASK_CANCELED, nunca depois
Quando a tarefa é excluída ao mesmo tempo
Então o comentário é recusado com 404 ou apagado junto com a tarefa
Quando o mencionado perde o acesso ao projeto ao mesmo tempo
Então ou a menção entra antes da mudança, ou o comentário é recusado com 422 INVALID_MENTION
E excluir a tarefa (com subtarefas) ou a organização apaga comentários e menções
```

### CA-08 — Isolamento e autorização

```gherkin
Dado as organizações A e B e projetos P1 e P2 em A
Quando as rotas de comentários são chamadas sob o prefixo de A com ids de B ou de tarefas/comentários de P2 sem acesso (caminho, query, cursor e menções no texto)
Então respondem 404, 400 ou 422 com o código esperado, sem dados alheios e sem efeito
E nas rotas por comentário o 404 é sempre COMMENT_NOT_FOUND com o mesmo corpo (inexistente, outra organização, projeto sem acesso), inclusive para o owner
E quem não lê o projeto recebe o mesmo corpo de "não existe"; quem lê e não tem permissão recebe 403 antes dos erros de estado
```

### CA-09 — Interface

```gherkin
Dado o detalhe da tarefa aberto
Quando o usuário digita "@bi", escolhe "Bia" pelo teclado e envia
Então o comentário aparece com a menção destacada e o envio é anunciado
E editar e excluir (com confirmação) atualizam a conversa e o foco
E textos com "<script>", "<img onerror>", "javascript:" e "data:" aparecem literalmente; só links http(s) viram links, com o endereço real exibido
E toda menção gravada aparece destacada na conversa
E as ações aparecem só com capacidade da API; projeto arquivado e tarefa cancelada mostram aviso, sem composer nem editar, mas com excluir
```

### CA-10 — Jornada

```gherkin
Dado um projeto com tarefas e um participante member
Quando o gerente comenta mencionando o member, edita o comentário e o member responde
E o gerente exclui um comentário e cancela a tarefa
Então a conversa mostra "editado" e "Comentário removido", fica sem composer e ainda permite excluir
```

## Testes obrigatórios

- [ ] Domínio: texto e menções (BR-031, BR-032), edição e exclusão
- [ ] Casos de uso com fakes: leitura, criação, edição, exclusão, moderação, ordem de decisão, limites, eventos
- [ ] Integração: catálogo e cascatas, repositório, concorrência (cancelar, excluir, perda de acesso), harness e baterias
- [ ] HTTP: contratos, 400/403/404/409/422/429, OpenAPI
- [ ] Frontend: conversa, composição com menções pelo teclado, segmentação com cargas de XSS
- [ ] E2E: jornada real; jornadas existentes verdes

## Evidências de validação

| Critério | Evidência (comando + resultado) | Data |
| -------- | ------------------------------- | ---- |

## Definição de concluído

- [ ] CA-01 a CA-10 comprovados por testes executados
- [ ] `pnpm verify`, `pnpm test:integration` e E2E passando
- [ ] `/review-code` sem bloqueantes e `/security-audit` sem Críticos/Altos abertos
- [ ] Documentação, regras de negócio (BR-031, BR-032), ADR 0015 (tabela), lints, roadmap e índice atualizados
