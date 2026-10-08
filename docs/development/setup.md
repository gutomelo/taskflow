# Setup do ambiente local

## Pré-requisitos

| Ferramenta       | Versão           | Verificar                        |
| ---------------- | ---------------- | -------------------------------- |
| Node.js          | 24 LTS (≥ 24.15) | `node -v` (há `.nvmrc`)          |
| pnpm             | 11.x             | `pnpm -v` (ou `corepack enable`) |
| Docker + Compose | 24+ / v2         | `docker compose version`         |

Nenhum serviço pago é necessário.

## Primeira execução

```bash
pnpm install                 # instala dependências; scripts de build liberados em pnpm-workspace.yaml
cp .env.example .env         # ajuste valores se necessário (nunca commite o .env)
pnpm infra:up                # PostgreSQL 18 + Redis 8 com healthcheck (portas só em 127.0.0.1)
pnpm db:generate             # gera o Prisma Client em libs/backend/shared/infrastructure/src/generated
pnpm dev                     # API em http://localhost:3333 e web em http://localhost:4200
```

Abra <http://localhost:4200>: a página de status mostra a saúde da API, do PostgreSQL e do Redis.

## Comandos

| Comando                                               | O que faz                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`                                            | Sobe API (watch) e web (dev server com proxy `/api` e `/health` → 3333). |
| `pnpm infra:up` / `pnpm infra:down` / `pnpm infra:ps` | Gerencia PostgreSQL e Redis (dados preservados em volumes).              |
| `pnpm db:generate`                                    | Gera o Prisma Client.                                                    |
| `pnpm db:migrate`                                     | `prisma migrate dev`: cria/aplica migrations no banco local.             |
| `pnpm db:deploy`                                      | `prisma migrate deploy`: aplica migrations pendentes (CI/produção).      |
| `pnpm db:studio`                                      | Prisma Studio.                                                           |
| `pnpm lint`                                           | ESLint em todos os projetos (inclui limites de dependência).             |
| `pnpm typecheck`                                      | Verificação de tipos de todos os projetos.                               |
| `pnpm test`                                           | Testes unitários (Vitest).                                               |
| `pnpm test:integration`                               | Testes de integração com Testcontainers (requer Docker).                 |
| `pnpm e2e`                                            | Playwright (sobe API e web automaticamente).                             |
| `pnpm build`                                          | Build de produção de todos os apps.                                      |
| `pnpm format` / `pnpm format:check`                   | Prettier.                                                                |
| `pnpm verify`                                         | lint + typecheck + test + build — gate local antes de commit.            |

## Variáveis de ambiente

Validadas na inicialização da API (`apps/api/src/config/env.ts`); valores inválidos impedem o start com mensagem clara. Referência completa em `.env.example`.

## Executar tudo com Docker (opcional)

Para simular produção localmente:

```bash
docker compose --profile app up --build
```

Sobe também `api` (imagem `infra/docker/api.Dockerfile`) e `web` (Nginx servindo o build Angular e fazendo proxy de `/api` e `/health` para a API) em <http://localhost:8080>. As migrations são aplicadas pelo serviço `migrate` antes da API iniciar.

## Problemas comuns

- **`ERR_PNPM_IGNORED_BUILDS`**: uma dependência nova tem script de instalação. Avalie e registre em `allowBuilds` (`pnpm-workspace.yaml`) com `true` apenas se for necessário.
- **Porta 5432/6379 ocupada**: ajuste `POSTGRES_PORT`/`REDIS_PORT` no `.env` e as URLs correspondentes.
- **`/health/ready` retorna 503**: verifique `pnpm infra:ps`; os containers precisam estar `healthy`.
- **Testes de integração falham ao iniciar**: Docker precisa estar acessível pelo usuário atual (Testcontainers).
