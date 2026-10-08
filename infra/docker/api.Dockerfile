# syntax=docker/dockerfile:1
# Imagem de produção da API (e alvo "migrate" para aplicar migrations).
# Build: docker build -f infra/docker/api.Dockerfile --target runtime -t taskflow-api .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NX_DAEMON=false NX_NO_CLOUD=true CI=true
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm nx run api:build:production

# Aplica migrations pendentes e encerra (docker compose: serviço "migrate").
FROM deps AS migrate
COPY prisma ./prisma
COPY prisma.config.ts ./
CMD ["pnpm", "prisma", "migrate", "deploy"]

FROM base AS prod-deps
WORKDIR /app
COPY --from=build /workspace/dist/apps/api/package.json /workspace/dist/apps/api/pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/dist/apps/api ./
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3333/health/live || exit 1
CMD ["node", "--enable-source-maps", "main.js"]
