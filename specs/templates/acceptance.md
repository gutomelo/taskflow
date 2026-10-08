# NNN — Nome da funcionalidade · Aceitação

## Cenários

### CA-01 — Título

```gherkin
Dado que ...
Quando ...
Então ...
```

- Teste que comprova: `caminho/do/arquivo.spec.ts` › nome do teste

### CA-02 — Falha esperada

```gherkin
Dado que ...
Quando ...
Então a API responde 422 com code "..."
```

## Testes obrigatórios

- [ ] Unitários de domínio para cada BR
- [ ] Casos de uso (sucesso, autorização negada, erro de regra)
- [ ] Integração (persistência, isolamento entre organizações, concorrência)
- [ ] HTTP (status e contratos, 401/403/404)
- [ ] Frontend (estados de UI, formulários)
- [ ] E2E (jornada crítica, se aplicável)

## Evidências de validação

| Critério | Evidência (comando + resultado) | Data |
| -------- | ------------------------------- | ---- |

## Definição de concluído

- [ ] Todos os cenários acima comprovados por testes executados
- [ ] `pnpm verify` passando
- [ ] Revisão de código sem bloqueantes
- [ ] Auditoria de segurança (se tocar auth/tenancy) sem achados críticos/altos abertos
- [ ] Documentação e roadmap atualizados
