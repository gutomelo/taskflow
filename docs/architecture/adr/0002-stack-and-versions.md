# 0002 — Stack, versões e configuração do monorepo

- **Status**: Aceito
- **Data**: 2026-10-08
- **Relacionados**: [specs/000-foundation](../../../specs/000-foundation/design.md)

## Contexto

O projeto exige Nx, Angular, Express, Prisma, PostgreSQL, Redis e TypeScript strict, com versões estáveis, compatíveis entre si e com suporte ativo. A verificação foi feita em 2026-10-08 consultando o registro npm (`npm view <pkg> version|peerDependencies|engines`) e a documentação oficial (Context7).

## Versões adotadas

| Tecnologia               | Versão                 | Observação                                                                                                            |
| ------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Node.js                  | 24 LTS (`>=24.15 <25`) | Exigido por Angular 22 (`^24.15`).                                                                                    |
| pnpm                     | 11.11                  | `packageManager` fixado; `allowBuilds` e `minimumReleaseAge` ativos.                                                  |
| Nx                       | 23.3                   | Plugins `@nx/angular`, `@nx/node`, `@nx/esbuild`, `@nx/eslint`, `@nx/vitest`, `@nx/playwright`.                       |
| TypeScript               | **6.0.3**              | TS 7.0 (port nativo) já é `latest`, mas Angular 22 exige `>=6.0 <6.1` e typescript-eslint `<6.1`.                     |
| Angular / Material / CDK | 22.2                   | Zoneless e standalone por padrão.                                                                                     |
| Tailwind CSS             | 4.3                    | Via `@tailwindcss/postcss`.                                                                                           |
| Express                  | 5.2                    | Propagação nativa de rejeições async.                                                                                 |
| Prisma ORM               | **7.10**               | O dist-tag `latest` aponta para `8.0.0-rc` (pré-lançamento); adotamos a última estável.                               |
| PostgreSQL               | 18 (imagem Docker)     |                                                                                                                       |
| Redis                    | 8 (imagem Docker)      | Licença AGPLv3/RSAL — adequada para uso local/autogerido.                                                             |
| Zod                      | 4.x                    | Validação nas fronteiras e fonte dos contratos.                                                                       |
| Pino / pino-http         | 10.x / 11.x            |                                                                                                                       |
| Vitest                   | **4.1**                | Vitest 5 é compatível com Angular 22, mas o gerador do Nx 23.3 o recusa no workspace; reavaliar quando o Nx suportar. |
| Playwright               | **1.63**               | 1.64 foi publicada há < 24h e está em quarentena pelo `minimumReleaseAge` do pnpm; não abrimos exceção.               |
| ESLint                   | 10 (flat config)       | ESLint 9 está fora de suporte.                                                                                        |

## Decisões de configuração

1. **Path aliases em vez de TS project references/workspaces**: o plugin Angular do Nx é suportado de forma madura com `paths` em `tsconfig.base.json`; o modo "TS solution" (workspaces + `customConditions`) adiciona complexidade sem ganho para um monorepo de aplicações (nada é publicado). `baseUrl` foi removido (deprecado no TS 6, removido no TS 7) — `paths` resolve relativo ao `tsconfig.base.json`.
2. **`apps/api` empacotada com esbuild (`bundle: true`, CJS)**: bibliotecas do workspace entram no bundle; `node_modules` permanece externo. O Prisma Client usa `moduleFormat = "cjs"` para compatibilidade. Node 24 suporta `require()` de pacotes ESM, então dependências ESM-only continuam utilizáveis.
3. **Prisma Client gerado dentro de `libs/backend/shared/infrastructure/src/generated/prisma`** (não versionado), mantendo Prisma restrito à camada de infraestrutura. Schema e migrations em `prisma/` na raiz; configuração em `prisma.config.ts` (Prisma 7 não lê `.env` automaticamente — o arquivo usa `process.loadEnvFile`).
4. **Sem `dotenv`**: Node 24 oferece `process.loadEnvFile()`.
5. **Scripts de instalação bloqueados por padrão** (`allowBuilds` em `pnpm-workspace.yaml`): liberados apenas `nx`, `@swc/core`, `prisma` e `@prisma/engines`.
6. **Sem Husky/lint-staged**: o hook de formatação do Claude Code, o `format:check` e o CI cobrem o objetivo sem adicionar hooks Git que podem ser contornados com `--no-verify`. Reavaliar se surgirem commits mal formatados de colaboradores humanos.
7. **`apps/worker` não criado na Fase 0**: sem filas, seria um app vazio. Nasce com a primeira fila real.
8. **Vitest com `resolve.tsconfigPaths` nativo do Vite 8** em vez dos plugins `nxViteTsPaths`/`nxCopyAssetsPlugin` e do executor `@nx/vitest:test`, deprecados no Nx 23 e removidos no Nx 24. Novas bibliotecas geradas pelo Nx precisam desse ajuste (skill `/create-domain-module`).
9. **Targets `prune*` removidos da API**: só funcionam no modo TS solution; o build já gera `package.json` e lockfile podados em `dist/apps/api`. O `.nxignore` reinclui o client Prisma gerado (ignorado pelo Git) para o Nx detectar `@prisma/client`.
10. **Variáveis da API com prefixo** (`API_PORT`, `API_HOST`): o Nx injeta o `.env` em todas as tarefas e `PORT` era lida pelo dev server do Angular.
11. **AI configs do template Nx descartadas**: o `create-nx-workspace` gerava configurações para seis ferramentas de IA e habilitava um marketplace de plugins de terceiros; mantivemos apenas a configuração própria de Claude Code em `.claude/`.

## Consequências

- **Positivas**: versões estáveis e compatíveis; supply chain mais protegida; caminho de migração para TS 7 preparado (sem `baseUrl`).
- **Negativas**: duas versões abaixo do `latest` (TypeScript, Vitest) por compatibilidade — monitoradas pelo Dependabot.
- **Como verificar**: `pnpm verify` e CI; `pnpm outdated` periódico.

## Referências

- Nx: <https://nx.dev/docs/technologies/angular/introduction>
- Prisma 7: <https://www.prisma.io/docs/orm/more/upgrades/to-v7>
- Angular: <https://angular.dev/reference/versions>
