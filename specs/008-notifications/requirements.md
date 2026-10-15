# 008 — Notificações · Requisitos

- **Status**: Aprovado
- **Fase do roadmap**: 2 — Colaboração (depois de `010-comments`)
- **Bounded contexts**: Notifications (`notifications`, **novo**: notificações in-app, preferência e resumo por e-mail). Produtores por Outbox: Collaboration (menções) e Tasks (atribuição). Consultas por porta: Tasks (tarefa visível, chave), Collaboration (menção ainda ativa), Organizations (membro atual, slug), Identity (nome e e-mail)
- **Autor / data**: Claude Code (com decisões do usuário) / 2026-10-15
- **Aprovado por / data**: usuário / 2026-10-15

## Objetivo

Avisar as pessoas quando algo pede a atenção delas — foram mencionadas num comentário ou receberam uma tarefa — dentro do app (sino com contador) e por um e-mail resumo, sem expor conteúdo a quem não pode vê-lo.

## Problema resolvido

Desde a spec 010 as menções são gravadas, mas ninguém é avisado; atribuir uma tarefa também passa despercebido. Quem não abre a tarefa certa não descobre que alguém precisa dele. A spec 010 deixou obrigações explícitas para esta (Outbox, conferência de acesso na entrega, deduplicação, e-mail sem conteúdo).

## Escopo

### Inclui

- **Gatilhos** (decisão 1): **menção em comentário** (cada pessoa mencionada pela primeira vez naquele comentário) e **tarefa atribuída a mim** por outra pessoa (na criação ou na troca de responsável).
- **In-app** (decisão 2): sino na barra da organização com o número de não lidas; lista paginada das notificações da organização ativa com ator, tipo, tarefa (chave e título) e data; marcar uma como lida ao abrir, e "marcar todas como lidas". Clicar leva à tarefa.
- **Atualização por consulta periódica** (decisão 4): o contador é consultado a cada 60 s e ao voltar para a aba; sem tempo real.
- **E-mail resumo** (decisão 2): no máximo **uma vez por hora** por pessoa, listando as notificações não lidas ainda não enviadas, de todas as organizações; **só contagens por tipo, chaves das tarefas e links**, agrupados pelo identificador (slug) da organização — nunca título, texto, nome de pessoa nem nome de organização (decisões 7 e 8; assunto fixo). Só entram notificações das **últimas 24 h** (decisão 10).
- **Preferência** (decisão 3): liga/desliga o e-mail resumo (padrão: ligado), na página da conta; o e-mail traz o link para essa página. O in-app sempre chega.
- **Validade** (decisão 6): notificação cujo alvo deixou de existir ou de ser visível para a pessoa (tarefa excluída, perdeu acesso ao projeto, saiu da organização, menção removida ou comentário removido) **não aparece** na lista, no contador nem no e-mail.
- **Retenção** (decisão 5): notificações com mais de **90 dias** são apagadas pela limpeza diária do worker.
- **Antispam**: mesma pessoa mencionada no mesmo comentário notifica uma vez enquanto a notificação existir (até 90 dias); teto de **menções** de um mesmo ator para um mesmo destinatário por hora (decisão 9: atribuições sem teto).

### Não inclui

- Tempo real (Socket.IO) e notificações push no navegador.
- Outros gatilhos: comentário em tarefa minha, mudança de status, prazos (spec futura).
- Preferências por tipo ou por canal; horário de silêncio; frequência configurável do resumo.
- E-mails de segurança (continuam em `identity`, fora de preferências — ADR 0011, item 7).
- Notificar menções gravadas antes desta spec (sem backfill — obrigação 5 da 010).

## Requisitos funcionais

| ID    | Requisito                                                                                                                                                                                                                                                                                                                                           | Prioridade |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RF-01 | Ao ser mencionada pela primeira vez num comentário (criação ou edição), a pessoa recebe uma notificação de menção — nunca duas para o mesmo comentário enquanto a primeira existir, mesmo que a menção seja tirada e reposta.                                                                                                                       | Must       |
| RF-02 | Ao receber uma tarefa de outra pessoa (criação com responsável ou troca de responsável), a pessoa recebe uma notificação de atribuição. Atribuir a si mesmo não notifica.                                                                                                                                                                           | Must       |
| RF-03 | Notificações são registradas de forma confiável: o fato e o evento são gravados juntos (Outbox); queda do worker atrasa, não perde; reprocessar não duplica.                                                                                                                                                                                        | Must       |
| RF-04 | A pessoa vê só as próprias notificações da organização ativa, mais recentes primeiro, paginadas, com ator, tipo, tarefa (chave e título), data e lida/não lida.                                                                                                                                                                                     | Must       |
| RF-05 | Sino com o número de não lidas (visíveis) da organização ativa, atualizado a cada 60 s e ao voltar para a aba.                                                                                                                                                                                                                                      | Must       |
| RF-06 | Marcar uma notificação como lida (ao abrir) e marcar todas como lidas.                                                                                                                                                                                                                                                                              | Must       |
| RF-07 | Notificação de alvo inexistente ou não visível para a pessoa não aparece na lista, no contador nem no e-mail.                                                                                                                                                                                                                                       | Must       |
| RF-08 | E-mail resumo no máximo uma vez por hora por pessoa, com as não lidas ainda não enviadas das últimas 24 h, agrupadas pelo slug da organização, só com contagens por tipo, chaves e links (sem nomes, título nem texto; assunto fixo); não enviado se não houver nada visível, se o e-mail não for verificado ou se a preferência estiver desligada. | Must       |
| RF-09 | Preferência "receber resumo por e-mail" (padrão ligado), editável na página da conta; o e-mail leva a ela.                                                                                                                                                                                                                                          | Must       |
| RF-10 | Limpeza diária apaga notificações com mais de 90 dias; sair da organização ou excluir a tarefa apaga as notificações correspondentes.                                                                                                                                                                                                               | Must       |
| RF-11 | Teto de menções por (organização, ator, destinatário) por hora; o excedente é descartado (registrado em log, só com ids).                                                                                                                                                                                                                           | Must       |
| RF-12 | Toda rota nova entra no harness de isolamento e na bateria de autorização.                                                                                                                                                                                                                                                                          | Must       |

## Requisitos não funcionais

| ID     | Categoria      | Requisito mensurável                                                                                                                                                 |
| ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RNF-01 | Privacidade    | Notificação nunca revela conteúdo (título, texto) de tarefa que a pessoa não pode ver no momento da leitura; e-mail sem título nem texto; eventos e logs só com ids. |
| RNF-02 | Isolamento     | Notificações com `organization_id`; só o destinatário as lê ou altera (404 para os demais, inclusive owner); FKs para a membership do destinatário e para a tarefa.  |
| RNF-03 | Confiabilidade | Entrega pelo menos uma vez com consumidores idempotentes por `eventId` e por chave de deduplicação.                                                                  |
| RNF-04 | Desempenho     | Página da lista (25) e contador em número fixo de consultas, independentes do número de notificações; contador limitado (ex.: "99+").                                |
| RNF-05 | Abuso          | Teto de menções por (ator, destinatário)/hora; resumo no máximo 1/h por pessoa e só das últimas 24 h; limites por usuário para contador, lista e marcar como lida.   |
| RNF-06 | Acessibilidade | WCAG 2.2 AA: botão do sino com nome e contador acessíveis, anúncio discreto de novas notificações, lista navegável por teclado.                                      |

## Regras de negócio

| BR                                    | Aplicação nesta feature                                                                                                                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-003                                | Atribuição só a quem contribui no projeto: o destinatário já pode ver a tarefa ao ser notificado.                                                                                                                                                                                 |
| BR-010                                | Fato (atribuição, comentário) e evento de integração na mesma transação (Outbox); notificação e e-mail só depois.                                                                                                                                                                 |
| BR-032                                | Menção não concede acesso: a notificação só aparece se a pessoa ainda lê o projeto e a menção ainda existe.                                                                                                                                                                       |
| **BR-033 — Notificação** (nova)       | Gatilhos: menção (uma vez por comentário e pessoa enquanto a notificação existir) e atribuição por outra pessoa. Pessoal: visível só ao destinatário, só enquanto o alvo existe e é visível para ele. Teto de menções por (ator, destinatário)/hora. Retenção de 90 dias.         |
| **BR-034 — Resumo por e-mail** (nova) | No máximo 1 por hora por pessoa; só não lidas, não enviadas, visíveis e das últimas 24 h; sem nomes, título nem texto (contagens, chaves, links; assunto fixo); só para e-mail verificado; respeita a preferência (padrão ligado); cada notificação entra em no máximo um resumo. |

## Critérios de aceitação (resumo)

- [ ] CA-01 Menção gera uma notificação ao mencionado (uma vez por comentário, mesmo tirando e repondo); o autor não se notifica.
- [ ] CA-02 Atribuição por outra pessoa gera notificação; atribuir a si mesmo não.
- [ ] CA-03 Worker parado: os eventos esperam; ao voltar, cada notificação é criada uma vez.
- [ ] CA-04 Lista, contador, marcar como lida e marcar todas, só das próprias notificações da organização ativa.
- [ ] CA-05 Perdeu acesso, tarefa excluída, menção ou comentário removidos: a notificação some da lista, do contador e do e-mail.
- [ ] CA-06 Resumo por e-mail no máximo 1/h, só das últimas 24 h, sem nomes, título nem texto, agrupado pelo slug da organização; preferência desligada não envia.
- [ ] CA-07 Teto de menções por (ator, destinatário)/hora descarta o excedente; atribuições não têm teto.
- [ ] CA-08 Isolamento e autorização: rotas no harness; notificação alheia ⇒ 404 idêntico a inexistente, inclusive para owner e admin da mesma organização.
- [ ] CA-09 Interface: sino com contador acessível, lista, abrir leva à tarefa e marca como lida, preferência na conta.
- [ ] CA-10 Jornada E2E: menção e atribuição viram notificações; o resumo chega no Mailpit sem conteúdo.

## Casos limite

- Mesma pessoa mencionada e atribuída na mesma tarefa: duas notificações (tipos diferentes).
- Comentário editado acrescentando uma menção nova: só a nova pessoa é notificada.
- Atribuição desfeita e refeita para a mesma pessoa: uma notificação por atribuição (cada uma é um fato novo), sujeita ao teto.
- Destinatário saiu da organização (ou a tarefa foi excluída) antes do worker processar: nada é gravado (a FK recusa e o consumidor descarta).
- Destinatário sem acesso ao projeto no momento do registro: a notificação é gravada, mas só aparece se e quando ele tiver acesso.
- Destinatário perdeu acesso ao projeto depois: a notificação some (sem apagar), e volta a aparecer se o acesso voltar dentro dos 90 dias.
- Resumo: notificações não visíveis no momento do envio não entram nem são reenviadas depois.
- Pessoa em várias organizações: resumo único com grupos por organização; o sino mostra só a organização ativa.

## Restrições e dependências

- Specs/ADRs: 004 (atribuição), 010 (menções e obrigações para a 008), ADRs 0008, 0011, **0017 (novo: Outbox para eventos de integração entre contextos)**, 0012, 0013, 0015.
- Sem dependência nova prevista (BullMQ, Outbox, SMTP/Mailpit já existem).

## Perguntas abertas

| #   | Pergunta                           | Responsável | Decisão                                                      |
| --- | ---------------------------------- | ----------- | ------------------------------------------------------------ |
| 1   | Quais gatilhos?                    | Usuário     | Menção em comentário e tarefa atribuída a mim (2026-10-15)   |
| 2   | Canais?                            | Usuário     | In-app + e-mail resumo (no máximo 1/h)                       |
| 3   | Preferências?                      | Usuário     | Liga/desliga o e-mail resumo; in-app sempre                  |
| 4   | Atualização do sino?               | Usuário     | Consulta periódica (60 s e ao voltar para a aba)             |
| 5   | Retenção?                          | Usuário     | 90 dias                                                      |
| 6   | Notificação que perdeu validade?   | Usuário     | Some da lista, do contador e do e-mail                       |
| 7   | Conteúdo no e-mail?                | Usuário     | Não: só chave, ator, tipo e link (revista pela decisão 8)    |
| 8   | Nome do ator no e-mail (phishing)? | Usuário     | Tirar: e-mail só com contagens, chaves e links; assunto fixo |
| 9   | Teto vale para quais tipos?        | Usuário     | Só menções                                                   |
| 10  | Resumo depois de religar?          | Usuário     | Só notificações das últimas 24 h                             |
