# BAML's native addon is glibc-linked (even the *-musl package), so alpine
# fails at `baml-cli generate` with a missing ld-linux-x86-64.so.2.
#
# Analysis on/off for the whole instance. The browser bundle bakes this in at
# `next build`; the server and the worker read it at runtime. Every stage
# sets it from this one ARG so build and runtime agree. Default on: the
# hosted deploy builds with no args. docker-compose.yaml passes the .env
# value instead, so a self-hosted setup keeps its own choice.
ARG NEXT_PUBLIC_ENABLE_ANALYSIS=true

FROM node:24-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ---- Stage 2: Build ----
FROM node:24-bookworm-slim AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate BAML client
RUN npx baml-cli generate

# Generate Prisma client
RUN npx prisma generate

# Build Next.js (standalone output). The flag lands here, after the generate
# steps, so flipping it does not invalidate those layers.
ARG NEXT_PUBLIC_ENABLE_ANALYSIS
ENV NEXT_PUBLIC_ENABLE_ANALYSIS=$NEXT_PUBLIC_ENABLE_ANALYSIS
RUN npm run build

# ---- Worker: hourly Gmail sync + Gemini Batch (same source tree, tsx) ----
FROM node:24-bookworm-slim AS worker
WORKDIR /app
ENV NODE_ENV=production
ARG NEXT_PUBLIC_ENABLE_ANALYSIS
ENV NEXT_PUBLIC_ENABLE_ANALYSIS=$NEXT_PUBLIC_ENABLE_ANALYSIS

# BAML's native HTTP client verifies TLS against the system CA store, which
# the slim base image does not ship (Node bundles its own, so plain fetch
# works without it). Without this every LLM call fails with "unable to get
# local issuer certificate".
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/baml_client ./baml_client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/auth.ts ./auth.ts
COPY --from=builder /app/auth.config.ts ./auth.config.ts

CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx scripts/worker.ts"]

# ---- Stage 3: Production runner ----
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ARG NEXT_PUBLIC_ENABLE_ANALYSIS
ENV NEXT_PUBLIC_ENABLE_ANALYSIS=$NEXT_PUBLIC_ENABLE_ANALYSIS

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# System CA store for BAML's TLS client (see worker stage).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Copy standalone build output
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Copy Prisma schema + migrations for prisma migrate deploy
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Copy generated Prisma client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client

# Install prisma CLI with all transitive deps for migrations
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm install prisma dotenv

# Copy BAML runtime artifacts
COPY --from=builder /app/baml_client ./baml_client

# Copy entrypoint script
COPY --from=builder /app/scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["sh", "docker-entrypoint.sh"]
