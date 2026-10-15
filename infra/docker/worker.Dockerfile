# syntax=docker/dockerfile:1
# Imagem de produção do worker (relay da outbox, e-mails e limpeza agendada; ADR 0011).
# Build: docker build -f infra/docker/worker.Dockerfile -t taskflow-worker .
# Migrations ficam a cargo do alvo "migrate" de infra/docker/api.Dockerfile.

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NX_DAEMON=false NX_NO_CLOUD=true CI=true
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm nx run worker:build:production

FROM base AS prod-deps
WORKDIR /app
COPY --from=build /workspace/dist/apps/worker/package.json /workspace/dist/apps/worker/pnpm-lock.yaml ./
# Mesma política de scripts de instalação do workspace (allowBuilds revisado).
COPY pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/dist/apps/worker ./
USER node
# Porta apenas do health (o worker não serve a API).
EXPOSE 3334
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3334/health/live || exit 1
CMD ["node", "--enable-source-maps", "main.js"]
