# Visão de produto

## O que é o TaskFlow

O TaskFlow é uma plataforma SaaS multi-tenant de gestão de projetos e tarefas para equipes de produto e engenharia. Combina a simplicidade visual do Kanban (Trello), a disciplina de planejamento por sprints (Jira) e a fluidez de interface de ferramentas modernas (Linear, ClickUp).

## Problema

Equipes pequenas e médias alternam entre ferramentas simples demais (sem regras, permissões ou rastreabilidade) e ferramentas pesadas demais (configuração extensa, lentidão, curva de aprendizado). Faltam:

- regras de trabalho aplicadas pelo sistema (ex.: não concluir tarefa com subtarefas obrigatórias pendentes);
- isolamento confiável entre clientes/organizações;
- colaboração em tempo real sem conflitos silenciosos de edição;
- visibilidade de andamento (sprints, prazos, produtividade) sem planilhas paralelas.

## Público-alvo

| Persona                 | Necessidade principal                                        |
| ----------------------- | ------------------------------------------------------------ |
| **Dono da organização** | Controlar quem acessa o quê, gerenciar equipes e assinatura. |
| **Gerente de projeto**  | Planejar backlog e sprints, acompanhar prazos e gargalos.    |
| **Membro de projeto**   | Ver suas tarefas, mover cards, colaborar com comentários.    |
| **Observador (viewer)** | Acompanhar andamento sem alterar dados.                      |

## Proposta de valor

1. **Regras reais de trabalho**: transições configuráveis, dependências e subtarefas obrigatórias aplicadas no backend.
2. **Confiabilidade**: isolamento por organização testado automaticamente, auditoria de alterações, controle de concorrência.
3. **Tempo real**: quadro Kanban sincronizado entre usuários.
4. **Clareza**: interface rápida, acessível e consistente.

## Princípios de produto

- Funcionalidade só entra com regra de negócio clara e critério de aceitação verificável.
- Segurança e isolamento entre organizações não são opcionais em nenhuma fase.
- Entregas incrementais: cada fase produz um produto utilizável, não módulos pela metade.

## Fora do escopo (por enquanto)

Faturamento/assinaturas, apps mobile nativos, integrações de terceiros (GitHub, Slack), automações por regras definidas pelo usuário, campos customizados e relatórios exportáveis. Podem ser reavaliados após a Fase 4.

## Contexto de portfólio

O projeto também demonstra competências de engenharia de software full stack: arquitetura modular, segurança multi-tenant, testes orientados a risco, observabilidade e desenvolvimento assistido por IA com Spec-Driven Development (ver [context-engineering.md](../context-engineering.md)).
