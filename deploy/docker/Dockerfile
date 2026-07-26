# =============================================================================
# PaySwap — Production Docker Image (multi-stage build)
# =============================================================================
# Stage 1: Install dependencies (cached layer)
# Stage 2: Build the Next.js app
# Stage 3: Production image (slim runtime)
#
# Base image: oven/bun:1-slim (matches the local dev/runtime which uses Bun).
# The production image exposes port 3000 and runs `bun start` (Next.js
# standalone server).
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1 — dependencies
# ---------------------------------------------------------------------------
FROM oven/bun:1-slim AS deps

WORKDIR /app

# Copy lockfile + package manifest first so this layer is cached when
# only source files change.
COPY package.json bun.lock ./

# Install with --frozen-lockfile so the build fails if the lockfile is
# out of sync with package.json.
RUN bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# Stage 2 — build
# ---------------------------------------------------------------------------
FROM oven/bun:1-slim AS builder

WORKDIR /app

# Copy the installed node_modules from the deps stage.
COPY --from=deps /app/node_modules ./node_modules

# Copy the rest of the source.
COPY . .

# Disable telemetry during the build.
ENV NEXT_TELEMETRY_DISABLED=1

# Build the Next.js app. The `build` script (in package.json) runs
# `next build` and copies static assets into the standalone output.
RUN bun run build

# ---------------------------------------------------------------------------
# Stage 3 — production runtime
# ---------------------------------------------------------------------------
FROM oven/bun:1-slim AS runner

WORKDIR /app

# Run as a non-root user for security.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

# Copy the standalone build output (Next.js produces a self-contained
# server.js under .next/standalone/).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Switch to the non-root user.
USER nextjs

# Expose the Next.js port.
EXPOSE 3000

# Set production environment.
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# Health check — hits the /healthz endpoint every 30s. Fails after 3
# consecutive failures (90s) → Kubernetes will restart the pod.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start the Next.js standalone server.
CMD ["bun", ".next/standalone/server.js"]
