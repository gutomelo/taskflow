# 001 — Identity & Access (autenticação e sessões) · Requisitos

- **Status**: Concluído (2026-10-09 — critérios CA-01…CA-17 validados; evidências em [tasks.md](tasks.md) e [acceptance.md](acceptance.md))
- **Fase do roadmap**: 1 — MVP
- **Bounded contexts**: Identity & Access (`identity`); infraestrutura assíncrona compartilhada (outbox + worker)
- **Autor / data**: Claude Code, 2026-10-08
- **Aprovado por / data**: usuário (GmSoftware), 2026-10-08

## Objetivo

Permitir que pessoas criem conta, comprovem a posse do e-mail, entrem e saiam com segurança e gerenciem suas sessões — fornecendo a identidade autenticada sobre a qual a multi-tenancy (spec 002) e as permissões (spec 006) serão construídas.

## Problema resolvido

Hoje a API não sabe quem faz cada requisição. Sem identidade confiável, nenhuma regra de tenant isolation, RBAC ou auditoria é possível.

## Escopo

### Inclui

- Cadastro com e-mail, nome e senha.
- Verificação de e-mail por link (com reenvio).
- Login, logout, renovação de sessão com refresh token rotativo e detecção de reutilização.
- Listagem e revogação das próprias sessões; troca de senha autenticada.
- Recuperação de senha por e-mail.
- Rate limiting e proteção CSRF nos endpoints de autenticação.
- Envio assíncrono e confiável de e-mails: Transactional Outbox → BullMQ → `apps/worker` (antecipado da Fase 4 por decisão do usuário; ADR 0011).
- Documentação OpenAPI 3.1 dos endpoints desta spec (Swagger UI em desenvolvimento).
- Telas: login, cadastro, verificação de e-mail, esqueci a senha, redefinir senha, segurança da conta (sessões e troca de senha), página inicial autenticada.
- Base para multi-tenancy: `RequestContext` autenticado (`userId`, `sessionId`, `requestId`) e a política "e-mail verificado" exposta para a spec 002.

### Não inclui

- Organizações, convites, organização ativa e isolamento por tenant (spec 002).
- Papéis e permissões (spec 006).
- Login social/SSO, MFA/TOTP, passkeys (backlog pós-MVP).
- Alteração de e-mail e exclusão de conta (backlog; exigem fluxos próprios de verificação e LGPD).
- Notificações in-app (spec 008).

## Requisitos funcionais

| ID    | Requisito                                                                                                                                              | Prioridade |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| RF-01 | Visitante cria conta com nome (1–100 caracteres), e-mail e senha conforme BR-011. E-mail é normalizado (trim + minúsculas) e único.                    | Must       |
| RF-02 | Após o cadastro, o sistema envia e-mail com link de verificação válido por 24 h; a resposta é idêntica exista ou não conta com aquele e-mail (BR-014). | Must       |
| RF-03 | Usuário confirma o e-mail pelo link **estando autenticado na mesma conta** e com clique explícito; o token é de uso único (BR-017).                    | Must       |
| RF-04 | Usuário autenticado e não verificado pode solicitar reenvio do e-mail de verificação (limitado por rate limit).                                        | Must       |
| RF-05 | Usuário entra com e-mail e senha; recebe sessão (cookies HttpOnly) mesmo sem e-mail verificado.                                                        | Must       |
| RF-06 | A sessão é renovada de forma transparente por refresh token rotativo (BR-012).                                                                         | Must       |
| RF-07 | Usuário sai (logout), revogando a sessão atual.                                                                                                        | Must       |
| RF-08 | Usuário vê suas sessões ativas (dispositivo/navegador aproximado, criação, último uso, sessão atual) e revoga qualquer uma.                            | Must       |
| RF-09 | Usuário autenticado troca a senha informando a senha atual; as demais sessões são revogadas e a sessão atual é rotacionada (BR-016).                   | Must       |
| RF-10 | Visitante solicita recuperação de senha; recebe link válido por 30 min, de uso único; a resposta não revela se o e-mail existe (BR-014).               | Must       |
| RF-11 | Visitante redefine a senha pelo link; todas as sessões do usuário são revogadas e o e-mail passa a constar como verificado.                            | Must       |
| RF-12 | `GET /api/v1/me` retorna id, nome, e-mail e se o e-mail está verificado.                                                                               | Must       |
| RF-13 | A página inicial autenticada exibe aviso persistente para confirmar o e-mail enquanto não verificado, com ação de reenvio.                             | Must       |
| RF-15 | Contas não verificadas há mais de 7 dias e sem login nesse período são removidas por job diário, liberando o e-mail para o titular real.               | Must       |
| RF-14 | Endpoints documentados em OpenAPI 3.1 gerado a partir dos schemas Zod de `libs/contracts`; Swagger UI disponível fora de produção.                     | Should     |

## Requisitos não funcionais

| ID     | Categoria       | Requisito mensurável                                                                                                                                                                                                                   |
| ------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RNF-01 | Segurança       | Senhas com Argon2id (m=19 MiB, t=2, p=1); nunca registradas em log nem retornadas.                                                                                                                                                     |
| RNF-02 | Segurança       | Tokens (refresh, verificação, recuperação) com ≥ 256 bits de entropia, persistidos **somente como hash** SHA-256.                                                                                                                      |
| RNF-03 | Segurança       | Nenhum token acessível a JavaScript; cookies `HttpOnly`, `Secure`, `SameSite=Lax`.                                                                                                                                                     |
| RNF-04 | Segurança       | Mutações autenticadas por cookie exigem verificação de `Origin` e token CSRF double-submit.                                                                                                                                            |
| RNF-05 | Abuso           | Rate limiting por IP (IPv6 /64) e por e-mail em cadastro, login, reenvio, recuperação e redefinição; atraso progressivo por conta no login (BR-018); respostas 429 com `Retry-After`; limites continuam ativos com Redis indisponível. |
| RNF-06 | Privacidade     | Cadastro, login e recuperação levam tempo semelhante para e-mails existentes e inexistentes (Argon2 sempre executado; trabalho constante na recuperação).                                                                              |
| RNF-07 | Confiabilidade  | Nenhum e-mail é perdido se a API cair após o commit: evento persistido na mesma transação (outbox); entrega pelo menos uma vez com retry e backoff.                                                                                    |
| RNF-08 | Revogação       | Sessão revogada perde acesso em ≤ 1 s para novas requisições (denylist no Redis; com Redis indisponível, consulta ao PostgreSQL).                                                                                                      |
| RNF-09 | Desempenho      | p95 de login ≤ 400 ms em ambiente local (dominado pelo Argon2); demais endpoints p95 ≤ 100 ms.                                                                                                                                         |
| RNF-10 | Acessibilidade  | Telas desta spec atendem WCAG 2.2 AA: rótulos, erros associados aos campos, foco no primeiro erro, navegação por teclado, sem dependência exclusiva de cor.                                                                            |
| RNF-11 | Observabilidade | Eventos de segurança (login ok/falha, reuso de refresh, revogação, redefinição de senha) registrados em log estruturado sem credenciais nem senha.                                                                                     |

## Regras de negócio

Novas regras propostas (serão incorporadas a `docs/product/business-rules.md` na aprovação):

| BR                                              | Regra                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BR-011 — Política de senha**                  | 8–128 caracteres, com ao menos uma letra maiúscula, uma minúscula, um dígito e um símbolo; não pode ser igual ao e-mail nem constar na lista local de senhas comuns/vazadas (100 mil mais frequentes). Validada no backend (domínio); o frontend apenas antecipa o feedback. Erro: `PASSWORD_POLICY_VIOLATION` (422) listando as regras não atendidas.        |
| **BR-012 — Rotação de refresh token**           | Cada uso emite novo refresh e invalida o anterior. Reapresentar um refresh rotacionado revoga a sessão inteira (`SESSION_REVOKED`, 401) e registra evento de segurança — **exceto** uma única vez para o predecessor imediato, até 5 s após a rotação, vindo do mesmo cliente (prefixo de IP e user agent), que recebe 409 `REFRESH_IN_PROGRESS` sem revogar. |
| **BR-013 — Gate de e-mail verificado**          | Criar ou entrar em organização exige e-mail verificado (aplicado pela spec 002 por porta própria ligada a uma consulta desta spec). Login e gestão da própria conta não exigem.                                                                                                                                                                               |
| **BR-014 — Não enumeração de contas**           | Cadastro, recuperação de senha e reenvio respondem igual para e-mails existentes e inexistentes; o titular de uma conta existente recebe e-mail informativo ("você já tem conta") no lugar do link de verificação. Envios a um mesmo e-mail são limitados e o excesso é suprimido silenciosamente.                                                            |
| **BR-015 — Expiração de sessão**                | Sessão expira após 7 dias sem uso (deslizante) ou 30 dias após o login (absoluto), o que ocorrer primeiro. Access token: 15 min.                                                                                                                                                                                                                              |
| **BR-017 — Confirmação de e-mail pelo titular** | O link de verificação só confirma o e-mail quando usado por uma sessão autenticada da **mesma conta** e por ação explícita do usuário; evita que uma conta criada por terceiro com o e-mail da vítima seja verificada pelo clique da vítima (pré-sequestro).                                                                                                  |
| **BR-018 — Atraso progressivo de login**        | Após 5 falhas consecutivas para uma conta, cada nova tentativa exige espera que dobra (1 s até 15 min), zerada no sucesso; sem bloqueio permanente.                                                                                                                                                                                                           |
| **BR-016 — Troca/redefinição de senha**         | Trocar a senha revoga todas as outras sessões, rotaciona a sessão atual e invalida tokens de recuperação pendentes; redefinir por e-mail revoga todas as sessões e invalida tokens de recuperação pendentes.                                                                                                                                                  |

## Critérios de aceitação (resumo)

- [x] CA-01 Cadastro cria conta não verificada e enfileira e-mail de verificação; e-mail chega ao Mailpit.
- [x] CA-02 Cadastro com e-mail existente responde igual e envia e-mail informativo.
- [x] CA-03 Link de verificação confirma o e-mail uma única vez, só pela própria conta autenticada; expirado/inválido falha com mensagem clara.
- [x] CA-04 Login correto cria sessão; credenciais erradas → 401 genérico; tempo de resposta semelhante para e-mail inexistente.
- [x] CA-05 Refresh rotaciona; reuso revoga a sessão; corrida legítima (mesmo cliente, ≤ 5 s, uma vez) não desloga.
- [x] CA-06 Expiração deslizante e absoluta respeitadas.
- [x] CA-07 Logout e revogação de sessão bloqueiam novas requisições daquela sessão em ≤ 1 s.
- [x] CA-08 Recuperação de senha completa revoga todas as sessões.
- [x] CA-09 Troca de senha exige a senha atual, revoga as outras sessões e rotaciona a atual.
- [x] CA-10 Rate limits retornam 429 com `Retry-After`.
- [x] CA-11 Mutação sem token CSRF ou com `Origin` estranha → 403.
- [x] CA-12 Política de senha (BR-011) validada no backend e refletida no formulário.
- [x] CA-13 E-mail não se perde se o worker estiver parado no momento do cadastro (entregue quando o worker volta).
- [x] CA-14 Jornada E2E: cadastro → e-mail → verificação → login → sessões → logout.
- [x] CA-15 OpenAPI 3.1 válido descreve todos os endpoints desta spec.
- [x] CA-17 Contas não verificadas há mais de 7 dias são removidas pela limpeza diária.
- [x] CA-16 Conta criada por terceiro com o e-mail da vítima não é verificada pelo clique da vítima (BR-017).

## Casos limite

- E-mail com maiúsculas/espaços → normalizado; `Joao@X.com` e `joao@x.com` são a mesma conta.
- Dois cadastros simultâneos com o mesmo e-mail → um cria a conta (unique constraint), o outro recebe a mesma resposta 202.
- Clique duplo no link de verificação → segundo clique informa "e-mail já confirmado", sem erro técnico.
- Link de verificação aberto sem sessão → pede login e só então oferece "Confirmar e-mail"; aberto logado em outra conta → recusa com orientação.
- Link de recuperação usado após troca de senha bem-sucedida → inválido.
- Duas abas renovando a sessão ao mesmo tempo → nenhuma é deslogada (BR-012, janela de tolerância).
- Refresh após a expiração absoluta → 401 e redirecionamento ao login, mesmo com uso recente.
- Worker processa o mesmo evento duas vezes → um único e-mail com link válido por evento; links mais antigos da mesma finalidade continuam válidos até expirar.
- Usuário revoga a própria sessão atual pela lista → comportamento igual ao logout.
- Redis indisponível → revogação consultada no PostgreSQL e rate limit em memória por processo; a API continua atendendo.

## Restrições e dependências

- ADRs: 0004 (multi-tenancy), 0005 (tokens e cookies — detalhado por esta spec), 0008 (eventos/outbox), 0011 (worker e outbox antecipados — novo).
- Ambiente local precisa de SMTP falso: Mailpit no Docker Compose (gratuito).
- A spec 002 depende de `RequestContext` autenticado e da política BR-013.

## Perguntas abertas

| #   | Pergunta                                                                      | Responsável | Decisão                                                       |
| --- | ----------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| 1   | Política de senha                                                             | Usuário     | Composição clássica (BR-011) — 2026-10-08                     |
| 2   | Verificação de e-mail                                                         | Usuário     | Obrigatória antes de criar/entrar em organização (BR-013)     |
| 3   | Duração da sessão                                                             | Usuário     | 7 dias deslizante, 30 dias absoluto (BR-015)                  |
| 4   | Envio de e-mails                                                              | Usuário     | Worker + BullMQ agora, com outbox (ADR 0011)                  |
| 5   | Bloquear senhas comuns/vazadas além da composição? (requisito ASVS L2 6.2.12) | Usuário     | Sim — lista local embarcada (BR-011), sem serviço externo     |
| 6   | Remetente e domínio de e-mail em produção (SPF/DKIM)                          | Usuário     | Pendente — fora do escopo local; variável `EMAIL_FROM`        |
| 7   | MFA é exigido pelo OWASP ASVS L2                                              | Usuário     | Desvio consciente do ASVS L2; TOTP em spec própria pós-MVP    |
| 8   | Contas não verificadas expiram?                                               | Usuário     | Sim — removidas após 7 dias sem verificação nem login (RF-15) |
