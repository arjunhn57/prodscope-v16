# ProdScope Backend
# Backend-only container — emulator stays on the host and is reached via ADB over TCP.
# Build:  docker build -t prodscope-backend .
# Run:    docker run --env-file .env -p 8080:8080 prodscope-backend

FROM node:20-slim AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:20-slim

# ADB client (talks to host emulator via network)
RUN apt-get update && \
    apt-get install -y --no-install-recommends android-tools-adb curl && \
    rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -r prodscope && useradd -r -g prodscope -m prodscope

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Writable dirs for runtime data
RUN mkdir -p /app/data /app/uploads /app/screenshots && \
    chown -R prodscope:prodscope /app

USER prodscope

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "server.js"]
