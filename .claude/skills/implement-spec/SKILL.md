---
name: implement-spec
description: Executa uma especificação SDD aprovada de forma incremental — uma tarefa de tasks.md por vez, com testes, verificação e atualização do progresso. Use quando o usuário pedir para implementar uma spec ou a próxima tarefa de uma spec.
argument-hint: "<specs/NNN-nome> [Tn]"
disable-model-invocation: true
---

# Implementar spec aprovada

Spec alvo: `$0` — tarefa: `$1` (se vazio, a primeira tarefa não concluída).

## 1. Pré-condições (pare se falharem)

- Leia `$0/requirements.md`, `design.md`, `tasks.md`, `acceptance.md`.
- O status no topo de `requirements.md` e `design.md` deve ser **Aprovado**. Se for Rascunho/Em revisão, não implemente: liste as decisões pendentes e peça aprovação.
- Verifique que as dependências da tarefa (campo "Depende de") estão concluídas.
- `git status` limpo ou com mudanças apenas desta spec; caso contrário, pergunte.

## 2. Planejar a tarefa

- Releia as regras de negócio (BR-xxx) e critérios de aceitação ligados à tarefa.
- Identifique contexto, camadas e bibliotecas afetadas; confirme tags/limites.
- Liste os testes que provarão a tarefa **antes** de escrever código.

## 3. Implementar (de dentro para fora)

domain → application → infrastructure → http/contratos → frontend, conforme a tarefa. Use as skills específicas quando aplicável: `/create-domain-module`, `/create-api-endpoint`, `/database-migration`, `/create-angular-feature`, `/write-tests`.

Delegue a um agente especialista apenas quando a especialidade melhorar o resultado (ex.: `database-specialist` para modelagem não trivial). Você continua responsável por integrar e validar.

## 4. Verificar

```bash
pnpm nx affected -t lint typecheck test
pnpm test:integration   # se tocou persistência/infra
pnpm nx run web-e2e:e2e # se a tarefa altera uma jornada coberta por E2E
```

Corrija até passar. Não use `skip`, não relaxe asserções.

## 5. Fechar a tarefa

- Marque a tarefa em `tasks.md` com `[x]` e registre a evidência (comando + resultado resumido).
- Atualize documentação/ADR/OpenAPI afetados.
- Rode `/review-code` se a tarefa for significativa (regra de negócio, segurança, persistência).
- Reporte: o que foi implementado, testado (com saída), documentado, e o que ficou pendente. Não faça commit sem o usuário pedir.

Implemente **uma tarefa por execução**, a menos que o usuário peça explicitamente um lote.
