# Multi-stage Dockerfile para Arqon (ARM64 na Oracle Cloud e x86_64)

# Etapa 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Etapa 2: Runner de producao
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget fontconfig
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/locales ./locales
COPY assets ./assets
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${HEALTH_PORT:-8080}/healthz || exit 1

# Alvo do worker de catalogo: docker build --target worker
FROM runner AS worker
CMD ["node", "dist/worker.js"]

# Alvo padrao (ultimo estagio): o bot
FROM runner AS bot
CMD ["node", "dist/index.js"]
