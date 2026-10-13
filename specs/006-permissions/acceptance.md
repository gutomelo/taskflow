# 006 — Permissões · Aceitação

## Cenários

### CA-01 — Matrizes e negação por padrão

```gherkin
Dado cada papel de organização (owner, admin, member, viewer) e cada papel de projeto (manager, member, viewer)
Quando a política avalia cada permissão do catálogo
Então o resultado é exatamente o da matriz de docs/security/authorization.md (transcrita no teste)
E uma permissão fora do catálogo, 'constructor', '__proto__' ou um papel desconhecido são negados
```

### CA-02 — Papel efetivo no projeto (BR-023)

```gherkin
Dado um owner ou admin da organização sem participação no projeto
Então o papel efetivo é manager
Dado um member da organização com papel de projeto viewer
Então o papel efetivo é viewer
Dado um viewer da organização com papel de projeto manager
Então o papel efetivo é viewer
Dado um member ou viewer sem participação no projeto
Então não há papel efetivo (o projeto responde 404)
```

### CA-03 — Criação de projetos configurável (BR-024)

```gherkin
Dado a organização com "membros podem criar projetos" ativado
Então as capacidades de um member incluem project:create
Quando um admin desativa a opção com a versão atual
Então as capacidades do member não incluem project:create e as do owner/admin incluem
Quando um member tenta alterar a opção
Então a API responde 403
Quando a versão enviada está desatualizada
Então a API responde 409 VERSION_CONFLICT
```

### CA-04 — Capacidades da organização

```gherkin
Dado um viewer da organização
Quando consulta a organização ou "minhas organizações"
Então as capacidades contêm organization:read e não contêm organization:update nem member:invite
```

### CA-05 — Ações por membro

```gherkin
Dado um admin listando membros de uma organização com dois owners
Então os owners vêm sem ações (nem alterar papel nem remover)
E um member vem com changeRoleTo = [admin, member, viewer] e remove = true
```

### CA-06 — Interface guiada por capacidades

```gherkin
Dado a interface aberta como viewer
Então não há controles de papel, remoção, convites nem edição de configurações
E não existe matriz de permissões no código do frontend
Quando uma chamada forjada tenta a ação
Então a API responde 403
```

### CA-07 — Isolamento obrigatório por rota

```gherkin
Dado o escopo do tenant com todas as rotas das specs 002 e 006
Então cada rota tem o caso gerado (prefixo de outra organização ⇒ 404)
E cada referência (caminho, query, corpo) tem caso com id real de outra organização (404 e banco inalterado)
Quando uma rota tenant-scoped nova é montada sem caso, ou uma rota com :organizationId fica fora do escopo
Então o teste falha nomeando a rota
```

### CA-08 — RLS

```gherkin
Dado o ADR 0014
Então ele registra a avaliação, os gatilhos de reavaliação, a preparação barata e a decisão de adiar para a Fase 4
E o ADR 0004 aponta para ele na parte de RLS
```

### CA-09 — Atualização da organização sob lock

```gherkin
Dado um admin com uma atualização da organização em andamento
Quando um owner o rebaixa a viewer antes de a atualização obter o lock
Então a atualização é negada com 403 e nome e configuração ficam como estavam
```

## Testes obrigatórios

- [ ] Kernel: matrizes tabela-driven, papel efetivo, negação por padrão
- [ ] Domínio e casos de uso: configuração, capacidades, ações por membro
- [ ] Integração: coluna nova, isolamento pelo harness (todas as rotas)
- [ ] HTTP: contratos, 403/409, OpenAPI
- [ ] Frontend: capacidades, ações, configuração
- [ ] E2E: jornadas existentes verdes

## Evidências de validação

| Critério | Evidência (comando + resultado) | Data |
| -------- | ------------------------------- | ---- |

## Definição de concluído

- [ ] CA-01 a CA-09 comprovados por testes executados (CA-08 por revisão do ADR)
- [ ] `pnpm verify`, `pnpm test:integration` e E2E passando
- [ ] `/review-code` sem bloqueantes e `/security-audit` sem Críticos/Altos abertos
- [ ] ADRs 0013 e 0014; documentação e roadmap atualizados
