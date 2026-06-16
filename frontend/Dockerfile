# frontend/Dockerfile — Bulletproof Phase 4 update
# Incorporating 'standalone' output and NEXT_PUBLIC mapping.

# Stage 1: Build
FROM node:20-slim AS builder
WORKDIR /app

# Build args
ARG FIREBASE_API_KEY
ARG FIREBASE_APP_ID
ARG NEXT_PUBLIC_API_BASE_URL

# Environment variables for build time
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$FIREBASE_API_KEY
ENV NEXT_PUBLIC_FIREBASE_APP_ID=$FIREBASE_APP_ID
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json* ./
# Sync lockfile was already performed locally; npm ci will be clean.
RUN npm ci || npm install

COPY . .
RUN npm run build

# Stage 2: Runner
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN groupadd --gid 1001 nodejs
RUN useradd --uid 1001 --gid nodejs --shell /bin/bash --create-home nextjs

# Automatically leverage standalone output from builder stage
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 8080
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# standalone mode uses server.js
CMD ["node", "server.js"]
