# syntax=docker/dockerfile:1.7
# Multi-stage build para Oraculo Backend (TypeScript)

# ── Stage 1: build (compila TS → JS) ──────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache tini wget
RUN addgroup -S app && adduser -S app -G app

ENV NODE_ENV=production \
    PORT=3000

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./

# Directorio data debe ser escribible para queue-store
RUN mkdir -p /app/data && chown -R app:app /app/data

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]