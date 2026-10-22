# Multi-stage Dockerfile para Arqon (Otimizado para ARM64 na Oracle Cloud e x86_64)

# Etapa 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Etapa 2: Runner de Produção
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/locales ./locales

USER node

CMD ["node", "dist/index.js"]
