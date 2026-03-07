# syntax=docker/dockerfile:1
# Build context: repo root  →  docker build -f sample-agent/Dockerfile .

# ---------------------------------------------------------------------------
# Stage 1 — builder
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy all package manifests so npm ci can resolve workspace deps
COPY package.json package-lock.json* ./
COPY agent-streemr/package.json            ./agent-streemr/
COPY agent-streemr-react/package.json      ./agent-streemr-react/
COPY agent-streemr-sample/package.json     ./agent-streemr-sample/
COPY sample-agent/package.json             ./sample-agent/
# sample-client is frontend-only; not needed at build time
RUN npm ci

# Copy source that actually needs to be compiled
COPY tsconfig.base.json ./
COPY agent-streemr/     ./agent-streemr/
COPY sample-agent/      ./sample-agent/

# Build the library first, then the agent
RUN npm run build -w agent-streemr
RUN npm run build -w sample-agent

# ---------------------------------------------------------------------------
# Stage 2 — runner  (minimal image, no devDeps, no source)
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

# Copy package manifests (same subset as builder) so npm ci creates symlinks
COPY package.json package-lock.json* ./
COPY agent-streemr/package.json            ./agent-streemr/
COPY agent-streemr-react/package.json      ./agent-streemr-react/
COPY agent-streemr-sample/package.json     ./agent-streemr-sample/
COPY sample-agent/package.json             ./sample-agent/

# Production-only install (creates workspace symlinks; no devDeps)
RUN npm ci --omit=dev

# Copy compiled output — the workspace symlink points here at runtime
COPY --from=builder /app/agent-streemr/dist  ./agent-streemr/dist
COPY --from=builder /app/sample-agent/dist   ./sample-agent/dist

WORKDIR /app/sample-agent

EXPOSE 8080

CMD ["node", "dist/server.js"]
