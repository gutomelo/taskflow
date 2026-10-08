---
paths:
  - 'docs/**'
  - 'specs/**'
  - '**/*.md'
---

# Regras de documentação

- Documentação, specs, ADRs e comentários em **português brasileiro**; identificadores de código citados permanecem em inglês e entre crases.
- Documento existe para ajudar a desenvolver, entender ou avaliar o projeto. Não crie arquivos vazios ou só com títulos para "completar a árvore".
- Sempre diferencie o estado: **Implementado**, **Planejado**, **Proposto** (decisão pendente) ou **Obsoleto**. Nunca descreva como existente algo que não existe no código.
- ADRs em `docs/architecture/adr/NNNN-titulo-em-kebab-case.md` (skill `/create-adr`). ADR aceito não é editado em substância; é **substituído** por um novo ADR que o referencia.
- Diagramas em Mermaid dentro do Markdown, sem imagens binárias.
- Links relativos entre documentos; ao mover/renomear, atualize os links (verifique com `grep`).
- `CLAUDE.md` permanece sucinto (< 200 linhas) e aponta para documentos; não duplique conteúdo de `docs/` nele nem nas regras.
- Ao concluir uma tarefa de spec, atualize `tasks.md` (checkbox + evidência) e a documentação afetada no mesmo commit.
