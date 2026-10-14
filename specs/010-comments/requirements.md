# 010 — Comentários e menções · Requisitos

- **Status**: Rascunho (revisão 2: achados das revisões e decisões 9 e 10)
- **Fase do roadmap**: 2 — Colaboração (primeira spec da fase; base para `008-notifications`)
- **Bounded contexts**: Collaboration (`collaboration`, **novo**: comentários e menções). Por uma porta de `collaboration`: Tasks (alvo do comentário — existência, visibilidade, estado e lock da tarefa), Projects (quem lê o projeto), Organizations (quem ainda é membro, para "Ex-membro") e Identity (nomes e busca de candidatos)
- **Autor / data**: Claude Code (com decisões do usuário) / 2026-10-14
- **Aprovado por / data**: —

## Objetivo

Permitir que o time discuta cada tarefa no próprio TaskFlow: comentários em texto simples, em ordem, com autoria e edição, e menções `@pessoa` registradas de forma estruturada para que a spec 008 possa notificar quem foi mencionado.

## Problema resolvido

Hoje a tarefa só tem título, descrição e campos (spec 004). A conversa sobre o trabalho (dúvidas, decisões, pedidos de revisão) acontece fora do produto e se perde. A visão de produto põe "colaborar com comentários" como necessidade principal do membro de projeto, e a Fase 2 começa por aqui: comentários e menções são a fonte dos eventos que as notificações (008) e o histórico de atividades vão consumir.

## Escopo

### Inclui

- **Comentários em qualquer tarefa** (decisão 6): tarefas de primeiro nível e subtarefas, cada uma com sua conversa (a do pai não agrega a das subtarefas).
- **Texto simples** (decisão 1): quebras de linha preservadas; links `http(s)` detectados só na exibição; sem HTML nem Markdown.
- **Menções** (decisões 2 e 3): `@pessoa` entre quem **lê o projeto** (participantes, inclusive viewers, e owner/admin da organização); a menção é gravada de forma estruturada (comentário × pessoa), destacada na interface e publicada em evento após o commit. **Nenhum aviso é entregue nesta spec** — entrega é da 008. Mencionar nunca concede acesso.
- **Editar** (decisão 4): o autor edita o próprio comentário a qualquer momento; o comentário mostra "editado" (sem histórico de versões); as menções acompanham o texto novo, e só as novas são conferidas.
- **Excluir** (decisão 4): o autor exclui o próprio comentário; o gerente do projeto modera (exclui comentários de outros). A exclusão troca o texto por "comentário removido", mantendo a posição na conversa e apagando as menções.
- **Estados** (decisões 5 e 9): projeto arquivado (BR-026) e tarefa cancelada (BR-029) impedem comentar e editar; **excluir continua permitido** (autor e moderação), para remover dado sensível sem reabrir a tarefa ou restaurar o projeto.
- **Ex-membros** (decisão 10): autor ou mencionado que não é mais membro da organização aparece como "Ex-membro", sem nome.
- Exclusão da tarefa ou da organização apaga a conversa.
- Interface: seção "Comentários" no detalhe da tarefa, com lista paginada, campo de novo comentário com sugestão de pessoas ao digitar `@`, edição e exclusão com confirmação.

### Não inclui

- Entrega de notificações (in-app, e-mail) e preferências — spec 008.
- Tempo real (decisão 8): Socket.IO tem spec própria na Fase 2, cobrindo quadro, tarefas e comentários.
- Histórico de atividades da tarefa intercalado na conversa (decisão 7) — spec própria da Fase 2.
- Markdown, anexos, reações, respostas em fio (threads), menção a equipes ou a `@todos`, histórico de edições.
- Comentários em projetos ou sprints.

## Requisitos funcionais

| ID    | Requisito                                                                                                                                                                                                                                                                                                          | Prioridade |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| RF-01 | Quem lê o projeto vê a conversa da tarefa: comentários com autor, texto, menções, data de criação e marca "editado", em ordem estável, paginada (mais recentes primeiro na API; a interface exibe em ordem cronológica com "carregar anteriores").                                                                 | Must       |
| RF-02 | Quem tem `comment:create` (manager e member efetivos no projeto) comenta numa tarefa com texto simples não vazio.                                                                                                                                                                                                  | Must       |
| RF-03 | O comentário pode mencionar pessoas que leem o projeto; as menções são gravadas (sem repetição, sem o próprio autor) e devolvidas com o nome atual. Mencionar quem não lê o projeto é recusado sem revelar se a pessoa existe.                                                                                     | Must       |
| RF-04 | O autor edita o próprio comentário informando a versão (BR-008); o comentário passa a mostrar "editado" e as menções são as do texto novo; menções mantidas não são conferidas de novo.                                                                                                                            | Must       |
| RF-05 | O autor exclui o próprio comentário; o manager do projeto exclui qualquer comentário da tarefa. Excluído vira "comentário removido" (sem texto, sem menções) na mesma posição; não pode mais ser editado; excluir de novo não muda nada.                                                                           | Must       |
| RF-06 | Projeto arquivado ou tarefa cancelada: criar e editar são recusados; ler e excluir continuam (decisão 9).                                                                                                                                                                                                          | Must       |
| RF-07 | Cada comentário e a resposta da conversa expõem as ações do usuário (comentar, editar, excluir), calculadas na API (padrão de capacidades da spec 006).                                                                                                                                                            | Must       |
| RF-08 | Sugestão de pessoas para mencionar, para quem pode comentar: lista paginada e filtrável por nome ou e-mail de quem lê o projeto da tarefa, sem o próprio usuário.                                                                                                                                                  | Must       |
| RF-09 | Criar, editar e excluir publicam eventos após o commit com as menções novas, para a spec 008 consumir; nada é publicado se a transação falhar.                                                                                                                                                                     | Must       |
| RF-10 | Excluir a tarefa (com subtarefas) ou a organização apaga os comentários e menções correspondentes.                                                                                                                                                                                                                 | Must       |
| RF-11 | Interface: seção "Comentários" no detalhe da tarefa — lista com autor, data relativa, "editado", "comentário removido", menções destacadas e links seguros; campo com sugestão `@` acessível por teclado; editar e excluir com confirmação; estados de carregamento, vazio e erro. Ações só com capacidade da API. | Must       |
| RF-12 | Toda rota nova entra no harness de isolamento (referências de caminho, corpo, query e menções no texto) e nas baterias de autorização dentro da organização.                                                                                                                                                       | Must       |
| RF-13 | O detalhe da tarefa mostra o número de comentários não removidos.                                                                                                                                                                                                                                                  | Should     |
| RF-14 | Cada comentário pode ser lido pelo seu id (link direto; `Location` da criação).                                                                                                                                                                                                                                    | Must       |
| RF-15 | Autor ou mencionado que não é membro atual da organização é exibido como "Ex-membro", sem nome (decisão 10).                                                                                                                                                                                                       | Must       |

## Requisitos não funcionais

| ID     | Categoria      | Requisito mensurável                                                                                                                                                                                               |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RNF-01 | Segurança      | Papel efetivo relido sob lock em toda escrita; sem acesso ao projeto ⇒ 404 idêntico a "não existe" (um único código por tipo de rota); com acesso e sem permissão ⇒ 403 antes de erros de estado.                  |
| RNF-02 | XSS e spoofing | Texto nunca interpretado como HTML em nenhuma camada; formatação bidi recusada e conteúdo isolado na exibição; links só `http`/`https`, com `rel="noopener noreferrer nofollow"`. Testes com cargas de XSS e bidi. |
| RNF-03 | Isolamento     | Comentários e menções com `organization_id`; FKs compostas para a tarefa da mesma organização; menções e candidatos só de quem lê o projeto, verificado sob lock.                                                  |
| RNF-04 | Desempenho     | Página da conversa (25 itens) em número fixo de consultas, independente do número de menções e autores (nomes em lote).                                                                                            |
| RNF-05 | Abuso          | Limites de tamanho do texto, de menções por comentário, de comentários por tarefa, de escritas por usuário por hora e de buscas de candidatos por minuto (valores no design).                                      |
| RNF-06 | Privacidade    | Eventos e logs levam só ids (nunca o texto do comentário); dados de quem saiu da organização não são exibidos.                                                                                                     |
| RNF-07 | Acessibilidade | WCAG 2.2 AA: sugestão de menções como combobox acessível, anúncios `aria-live` de envio/erro, foco gerenciado em editar/excluir.                                                                                   |

## Regras de negócio

| BR                             | Aplicação nesta feature                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BR-002                         | Matriz da spec 006: `comment:create` manager/member; `comment:update` só o autor; `comment:delete` autor (member) ou qualquer um (manager, moderação); viewer só lê.                                                                                                                                                                                                     |
| BR-007                         | Auditoria completa continua na Fase 3; os eventos desta spec carregam autor, alvo e se houve moderação.                                                                                                                                                                                                                                                                  |
| BR-008                         | Editar e excluir informam a versão do comentário (`VERSION_CONFLICT`, 409).                                                                                                                                                                                                                                                                                              |
| BR-010                         | Comentário e menções gravados juntos; eventos só depois do commit.                                                                                                                                                                                                                                                                                                       |
| BR-026                         | Projeto arquivado: sem comentar nem editar; excluir permitido (decisão 9).                                                                                                                                                                                                                                                                                               |
| BR-029                         | Tarefa cancelada: sem comentar nem editar até reabrir; excluir permitido (decisão 9).                                                                                                                                                                                                                                                                                    |
| **BR-031 — Comentário** (nova) | Texto simples de 1 a 5 000 caracteres depois de aparar, Unicode bem formado, sem caracteres de controle além de quebra de linha e tabulação, sem formatação bidi; autor fixo; editar só o autor, com versão; excluir (autor ou manager, inclusive em tarefa cancelada e projeto arquivado) vira "removido" de forma irreversível e idempotente; ordem `(criado em, id)`. |
| **BR-032 — Menção** (nova)     | Só de quem lê o projeto no momento da escrita (verificado sob lock); na edição, a verificação vale só para as menções novas; sem repetição; o autor não se menciona; até 20 por comentário; mencionar não concede acesso; só as menções novas geram evento; comentário removido não tem menções.                                                                         |

## Critérios de aceitação (resumo)

- [ ] CA-01 Conversa da tarefa em ordem estável, paginada, com autor, menções, "editado", "comentário removido" e "Ex-membro".
- [ ] CA-02 Member e manager comentam; viewer só lê; texto inválido é recusado.
- [ ] CA-03 Menções só de quem lê o projeto; inválida recusada sem vazar existência; sem repetição nem autor; eventos só com menções novas.
- [ ] CA-04 Autor edita com versão (mesmo mantendo menção de quem perdeu acesso); outra pessoa não edita; conflito de versão 409.
- [ ] CA-05 Autor exclui o próprio; manager modera; member não exclui de outros; excluído não edita; excluir de novo não muda nada.
- [ ] CA-06 Projeto arquivado e tarefa cancelada: sem comentar nem editar (depois do 403), excluir continua; autor rebaixado a viewer não edita nem exclui.
- [ ] CA-07 Excluir tarefa ou organização apaga a conversa; cancelar a tarefa ou perder acesso enquanto alguém comenta é serializado.
- [ ] CA-08 Isolamento e autorização: rotas novas no harness e nas baterias; ids de outra organização ou de projeto sem acesso ⇒ 404 único, sem efeito.
- [ ] CA-09 Interface: comentar, mencionar pelo teclado, editar, excluir; cargas de XSS e bidi exibidas com segurança.
- [ ] CA-10 Jornada E2E real: comentar com menção, editar, excluir e ver a conversa sem composer na tarefa cancelada.

## Casos limite

- Comentário só com espaços ou quebras de linha: recusado.
- A mesma pessoa mencionada duas vezes: uma menção. O autor se mencionando: texto mantido, sem menção.
- Mencionar alguém que perde o acesso depois: a menção continua no comentário (editar o texto a mantém); a 008 confere o acesso na entrega.
- Autor sai da organização: seus comentários ficam, exibidos como "Ex-membro". Sai só do projeto: continua com nome, mas não edita nem exclui (não lê o projeto).
- Autor rebaixado a viewer: não edita nem exclui os próprios comentários.
- Editar removendo todas as menções: menções apagadas, sem evento de menção.
- Tarefa cancelada enquanto alguém envia um comentário: o comentário entra antes do cancelamento ou é recusado.
- Tarefa excluída enquanto alguém comenta: o comentário é recusado (404) ou apagado junto.
- Comentário com dado sensível em tarefa cancelada: autor ou manager exclui sem reabrir.
- Texto com `<script>`, `javascript:` ou `data:`: guardado como texto, exibido literalmente, link só para `http(s)`. Formatação bidi (ex.: U+202E) é recusada.

## Restrições e dependências

- Specs/ADRs: 003 (projetos, participantes, arquivamento), 004 (tarefas, cancelamento, porta `ProjectAccess`), 006 (matriz `comment:*`), ADRs 0003, 0006, 0008, 0011, 0013, 0015.
- Sem dependência nova prevista.
- Obrigações para a 008 registradas no design (Outbox, conferência na entrega, deduplicação, texto fora do e-mail).

## Perguntas abertas

| #   | Pergunta                                         | Responsável | Decisão                                                                                       |
| --- | ------------------------------------------------ | ----------- | --------------------------------------------------------------------------------------------- |
| 1   | Formato do texto?                                | Usuário     | Texto simples; links detectados na exibição (2026-10-14)                                      |
| 2   | Quem pode ser mencionado?                        | Usuário     | Quem lê o projeto (inclui viewers e owner/admin); mencionar não concede acesso                |
| 3   | O que a menção faz nesta spec?                   | Usuário     | Registro estruturado + evento pós-commit; entrega na 008                                      |
| 4   | Edição e exclusão?                               | Usuário     | Autor edita a qualquer momento ("editado", sem histórico); excluir vira "comentário removido" |
| 5   | Tarefa cancelada e projeto arquivado?            | Usuário     | Somente leitura (BR-026, BR-029), revista pela decisão 9                                      |
| 6   | Subtarefas têm comentários?                      | Usuário     | Sim, toda tarefa                                                                              |
| 7   | Histórico de atividades nesta spec?              | Usuário     | Fora (spec própria da Fase 2)                                                                 |
| 8   | Tempo real?                                      | Usuário     | Sem tempo real (Socket.IO em spec própria)                                                    |
| 9   | Excluir em tarefa cancelada / projeto arquivado? | Usuário     | Permitido (autor e moderação); criar e editar seguem bloqueados — recomendação das revisões   |
| 10  | Como exibir quem saiu da organização?            | Usuário     | "Ex-membro", sem nome — recomendação da revisão de segurança                                  |
