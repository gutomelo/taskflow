---
name: review-code
description: Revisa as alterações atuais do TaskFlow (diff local ou branch vs master) verificando funcionalidade, arquitetura, segurança, manutenção e testes, com achados por gravidade. Use após concluir uma tarefa de spec e antes de commit ou PR.
argument-hint: '[base-ref (padrão: master)]'
context: fork
agent: code-reviewer
background: false
---

# Revisão de código

Base de comparação: `$ARGUMENTS` (se vazio, use `master`).

1. Delimite a mudança: `git status`, `git diff`, `git diff <base>...HEAD --stat` e o diff completo dos arquivos relevantes.
2. Identifique a spec relacionada (mensagens de commit, nome da branch, `specs/*/tasks.md` alterado) e leia `requirements.md`/`acceptance.md`.
3. Leia as regras de `.claude/rules/` aplicáveis aos caminhos alterados.
4. Revise conforme seu checklist (correção, regras de negócio, segurança/tenancy, arquitetura, testes, legibilidade, performance).
5. Execute `pnpm nx affected -t lint typecheck test --base=<base>` e inclua o resultado real.

Entregue: achados por gravidade (Bloqueante / Importante / Sugestão) com `arquivo:linha`, cenário de falha e correção, mais o veredito final. Não edite arquivos.
