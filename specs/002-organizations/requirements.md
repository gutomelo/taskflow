# 002 — Organizações e multi-tenancy · Requisitos

- **Status**: Aprovado
- **Fase do roadmap**: 1 — MVP
- **Bounded contexts**: Organizations & Teams (`organizations`, novo); consulta a Identity & Access (`identity`) por porta
- **Autor / data**: Claude Code (com decisões do usuário) / 2026-10-09
- **Aprovado por / data**: usuário / 2026-10-09

## Objetivo

Permitir que um usuário com e-mail verificado crie uma organização (o tenant do TaskFlow), convide pessoas por e-mail, gerencie membros e papéis e alterne entre as organizações de que participa — com isolamento entre organizações garantido desde a primeira feature tenant-scoped.

## Problema resolvido

Hoje o TaskFlow tem contas, mas nenhum espaço de trabalho: não há onde criar projetos nem como trabalhar em equipe. Todas as features seguintes (projetos, tarefas, Kanban) são tenant-scoped e dependem de uma organização ativa resolvida no servidor. Esta spec entrega o tenant, a associação usuário ↔ organização e a infraestrutura de contexto de tenant que as próximas specs reutilizam.

## Escopo

### Inclui

- Criar organização (nome + slug escolhido na criação), com o criador como `owner`.
- Listar as organizações do usuário e escolher a organização ativa; a organização ativa aparece na URL do app (`/o/:slug/...`).
- Editar o nome da organização.
- Convites por e-mail com papel (`admin`, `member`, `viewer`): criar, listar pendentes, reenviar, revogar e aceitar.
- Membros: listar, alterar papel, remover e sair da organização.
- Contexto de tenant no backend: organização ativa validada contra a membership a cada requisição, entregue aos casos de uso; base para as specs 003+.
- Onboarding: usuário verificado sem organização é levado a criar a primeira ou a aceitar um convite.
- BR-013 (spec 001): criar organização e aceitar convite exigem e-mail verificado.

### Não inclui

- Equipes (adiadas para a spec que as usar para dar acesso a projetos; roadmap atualizado).
- Exclusão de organização (backlog: exige carência, exportação e retenção).
- Link de convite compartilhável (só convite nominal por e-mail).
- Fluxo dedicado de transferência de propriedade (coberto por vários owners: promover outro e então sair).
- Alteração de slug após a criação.
- Matriz completa de permissões de projeto e decisão sobre RLS (spec 006).
- Planos, cobrança, limites comerciais; SSO/domínios verificados.
- Trilha de auditoria transacional (BR-007): **desvio registrado** — nesta spec mudanças de membership/papel e convites ficam no log de segurança; a trilha em banco nasce com o contexto `audit` (Fase 3).
- Notificações in-app (spec 008).

## Requisitos funcionais

| ID    | Requisito                                                                                                                                                                                                                         | Prioridade |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| RF-01 | Usuário com e-mail verificado cria organização com nome e slug (sugerido a partir do nome, editável antes de criar); torna-se `owner`. E-mail não verificado ⇒ recusado (BR-013).                                                 | Must       |
| RF-02 | Usuário lista as organizações das quais é membro ativo (nome, slug, papel).                                                                                                                                                       | Must       |
| RF-03 | Toda requisição tenant-scoped indica a organização desejada; o servidor valida a membership ativa do usuário e entrega `organizationId` e papel ao caso de uso. Sem membership ⇒ 404.                                             | Must       |
| RF-04 | O app abre a organização pelo slug na URL (`/o/:slug`); oferece seletor para alternar; usuário sem organização vai ao onboarding (criar ou aceitar convite).                                                                      | Must       |
| RF-05 | `owner` e `admin` editam o nome da organização.                                                                                                                                                                                   | Must       |
| RF-06 | `owner` e `admin` convidam um e-mail com papel `admin`, `member` ou `viewer`; o convidado recebe e-mail com link de aceite. Convites nunca criam `owner` (BR-021). Reconvidar quem tem convite aberto atualiza o papel e reenvia. | Must       |
| RF-07 | `owner` e `admin` listam convites pendentes, reenviam (novo link, invalida o anterior) e revogam.                                                                                                                                 | Must       |
| RF-08 | O convidado aceita o convite estando autenticado na conta com o e-mail convidado e verificado; vira membro com o papel do convite. Sem conta, o link leva ao cadastro e depois ao aceite.                                         | Must       |
| RF-09 | Membros listam os membros da organização (nome, e-mail, papel, desde quando), em páginas.                                                                                                                                         | Must       |
| RF-10 | `owner` altera o papel de qualquer membro, inclusive promover a `owner`; `admin` altera papéis entre `admin`, `member` e `viewer`, exceto de owners.                                                                              | Must       |
| RF-11 | `owner` remove qualquer membro; `admin` remove membros que não são owners. A remoção vale na próxima requisição do removido.                                                                                                      | Must       |
| RF-12 | Qualquer membro sai da organização, exceto o último owner.                                                                                                                                                                        | Must       |
| RF-13 | Eventos de segurança registrados em log estruturado: organização criada, convite criado/revogado/aceito, papel alterado, membro removido/saiu.                                                                                    | Should     |

## Requisitos não funcionais

| ID     | Categoria                   | Requisito mensurável                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RNF-01 | Isolamento                  | Cada endpoint tenant-scoped tem teste de integração com duas organizações: membro de A não lê, lista, altera nem referencia dados de B (404).                                                                                                                                                                                                                                                                                    |
| RNF-02 | Segurança                   | Token de convite com ≥ 256 bits, persistido só como hash, no fragmento da URL, uso único, validade de 7 dias; aceite só pela conta dona do e-mail (BR-020).                                                                                                                                                                                                                                                                      |
| RNF-03 | Segurança                   | Organização ativa nunca é aceita do cliente como prova: validação de membership a cada requisição, sem cache além da requisição.                                                                                                                                                                                                                                                                                                 |
| RNF-04 | Abuso                       | Limites (429 com `Retry-After`, ou supressão silenciosa no envio): convites por (organização, destinatário) (3/dia, 10/semana) com teto global por destinatário somando organizações (20/dia) — _rev. 4_ —, por conta (30/dia), por organização (50/dia), reenvio por (organização, e-mail) (1/10 min); criação de organização 5/dia por usuário (tentativas) e até 20 organizações como owner; até 100 memberships por usuário. |
| RNF-05 | Consistência                | Alterações no conjunto de owners são serializadas: nenhuma combinação de operações concorrentes deixa a organização sem owner (BR-019).                                                                                                                                                                                                                                                                                          |
| RNF-06 | Desempenho                  | Resolução do contexto de tenant: uma consulta indexada por requisição; listagens de membros e convites paginadas por cursor (padrão 25, máximo 100) com p95 < 300 ms por página.                                                                                                                                                                                                                                                 |
| RNF-07 | Acessibilidade              | Telas desta spec atendem WCAG 2.2 AA (rótulos, erros associados, foco, teclado, sem dependência exclusiva de cor).                                                                                                                                                                                                                                                                                                               |
| RNF-08 | Privacidade e anti-phishing | Nome da organização e do convidante validados como texto exibível (sem controles, CR/LF, bidi, zero-width) e exibidos entre aspas em frase fixa, com aviso "se não esperava, ignore"; logs sem e-mail em claro; convites encerrados apagados após 30 dias.                                                                                                                                                                       |

## Regras de negócio

| BR                                       | Aplicação nesta feature                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BR-008                                   | Concorrência: membership com versão; alterações conflitantes ⇒ 409 `VERSION_CONFLICT`.                                                                                                                                                                                                                                                         |
| BR-013 (spec 001)                        | Criar organização e aceitar convite exigem e-mail verificado (porta `EmailVerificationChecker`).                                                                                                                                                                                                                                               |
| **BR-019 — Sempre um owner** (nova)      | Toda organização tem ≥ 1 membro ativo com papel `owner`. O último owner não pode sair, ser removido nem rebaixado (`LAST_OWNER`, 409). Mudanças no conjunto de owners são serializadas por organização.                                                                                                                                        |
| **BR-020 — Convite nominal** (nova)      | Convite vale para um e-mail, um papel e uma organização; uso único; expira em 7 dias; aceito apenas por conta autenticada com aquele e-mail verificado (outra conta ⇒ 403 `INVITATION_FOR_ANOTHER_ACCOUNT`, sem consumir). Um convite pendente por e-mail e organização: reenviar substitui o link. E-mail já membro ⇒ 409 `ALREADY_A_MEMBER`. |
| **BR-021 — Hierarquia de papéis** (nova) | Só `owner` promove alguém a owner ou altera/remove um owner; `admin` gerencia papéis e remoções entre `admin`, `member` e `viewer` (alinhado à matriz de `docs/security/authorization.md`). Ninguém altera o próprio papel, exceto o owner que se rebaixa havendo outro owner.                                                                 |
| **BR-022 — Slug da organização** (nova)  | Único globalmente, 3–40 caracteres `[a-z0-9-]`, começa por letra, sem hífen no fim nem duplo; palavras reservadas recusadas contra impersonação (ex.: `admin`, `support`, `taskflow`, `security`); imutável após a criação (`SLUG_TAKEN` 409, `INVALID_SLUG` 400).                                                                             |

## Critérios de aceitação (resumo)

- [x] CA-01 Usuário verificado cria organização e vira owner; não verificado recebe 403 `EMAIL_NOT_VERIFIED`.
- [x] CA-02 Slug inválido, reservado ou em uso é recusado; slug não muda após a criação.
- [x] CA-03 Membro de A não acessa nada de B (404 em todos os endpoints tenant-scoped).
- [x] CA-04 Convite chega ao Mailpit; aceite pela conta convidada cria membership com o papel do convite.
- [x] CA-05 Aceite por outra conta ⇒ 403 sem consumir; convite expirado, revogado ou usado ⇒ 400 `INVALID_OR_EXPIRED_INVITATION`.
- [x] CA-06 Reenviar invalida o link anterior; revogar impede o aceite.
- [x] CA-07 Admin não promove a owner nem altera ou remove owners; owner pode.
- [x] CA-08 Último owner não sai, não é removido nem rebaixado; duas operações concorrentes sobre owners nunca deixam zero owners.
- [x] CA-09 Membro removido perde o acesso na próxima requisição.
- [x] CA-10 App abre `/o/:slug`, alterna organizações pelo seletor e leva quem não tem organização ao onboarding.
- [x] CA-11 Jornada E2E: criar organização → convidar → convidado se cadastra e aceita pelo link do Mailpit → aparece na lista de membros → owner altera o papel → convidado sai.
- [x] CA-12 Limites de criação e convite respondem 429.

## Casos limite

- Convite para e-mail sem conta: o link leva ao cadastro; após verificar o e-mail e entrar, o aceite continua (token mantido em memória como na spec 001).
- Convite para quem já é membro ⇒ 409; para quem tem convite pendente ⇒ o reenvio substitui o anterior.
- Aceite com o e-mail ainda não verificado ⇒ 403 `EMAIL_NOT_VERIFIED`, convite preservado.
- Membro removido com convite antigo ainda válido: convites são invalidados ao aceitar; não existem convites para quem já é membro.
- Papel alterado entre a leitura da lista e a ação ⇒ 409 `VERSION_CONFLICT`.
- Dois owners rebaixando um ao outro ao mesmo tempo ⇒ um sucede, o outro recebe `LAST_OWNER`.
- Usuário removido navegando em `/o/:slug` ⇒ próxima chamada 404 e o app o leva às suas organizações.
- Slug digitado com maiúsculas/acentos: normalizado na sugestão; o valor enviado precisa obedecer ao formato.
- Organização acessada por slug inexistente ou sem membership ⇒ mesma resposta (404), sem revelar existência.

## Restrições e dependências

- Specs/ADRs dos quais esta depende: spec 001 (identidade, sessão, CSRF, worker/outbox de e-mails, BR-013); ADR 0004 (banco compartilhado com `organization_id`); ADR 0005; ADR 0011.
- Contextos não se acoplam: `organizations` consulta a identidade (e-mail verificado, nome/e-mail de usuários) por portas próprias ligadas no composition root.
- Restrições técnicas: sem RLS nesta spec (decisão na 006); e-mails pelo worker existente.

## Perguntas abertas

| #   | Pergunta                                                 | Responsável | Decisão                                                                                                                          |
| --- | -------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Como o usuário chega à primeira organização?             | Usuário     | Cria manualmente (onboarding guiado) ou aceita convite                                                                           |
| 2   | Como membros entram?                                     | Usuário     | Convite nominal por e-mail (sem link compartilhável)                                                                             |
| 3   | Equipes nesta spec?                                      | Usuário     | Adiadas para a spec que as usar; roadmap atualizado                                                                              |
| 4   | Como a organização ativa aparece?                        | Usuário     | Slug na URL do app (`/o/:slug`)                                                                                                  |
| 5   | Escopo da gestão de membros                              | Usuário     | Completa: convidar, reenviar/revogar, alterar papel, remover, sair                                                               |
| 6   | Quantos owners?                                          | Usuário     | Vários, sempre ≥ 1 (BR-019)                                                                                                      |
| 7   | Exclusão de organização                                  | Usuário     | Fora do escopo (backlog)                                                                                                         |
| 8   | Slug editável?                                           | Usuário     | Escolhido na criação e imutável (BR-022)                                                                                         |
| 9   | Como a API recebe a organização ativa?                   | Design      | Prefixo de caminho `/api/v1/organizations/{organizationId}/…` para todo recurso tenant-scoped (ADR 0012, proposto com esta spec) |
| 10  | E-mail dos membros visível para quem?                    | Usuário     | Todos os membros veem o e-mail dos demais (decisão do usuário; a revisão de segurança recomendava só owner/admin)                |
| 11  | Reconvidar com papel diferente                           | Usuário     | Atualiza o papel do convite aberto e reenvia                                                                                     |
| 12  | Limite por destinatário (achado M1 da auditoria, rev. 4) | Usuário     | Por (organização, destinatário) 3/dia e 10/semana + teto global 20/dia: uma organização não esgota a cota das outras             |
