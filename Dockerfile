# ==============================================================================
# Mega Auction V3 — Persistent Auction Worker
# ==============================================================================
# This Dockerfile builds ONLY the background worker process.
# It does NOT build or serve the Next.js application.
# ==============================================================================

# --- Stage 1: Install dependencies ---
FROM node:24-slim AS deps

WORKDIR /app

# Copy only dependency manifests for layer caching
COPY package.json package-lock.json ./

# Install all dependencies (devDependencies needed for tsx runtime)
RUN npm ci

# --- Stage 2: Production runtime ---
FROM node:24-slim AS runner

WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy package files (needed for npm run worker)
COPY package.json package-lock.json ./

# Copy worker entrypoint
COPY scripts/ ./scripts/

# Copy application source required by the authenticated tick client import chain:
#   worker.ts → tick-client.ts → tick-auth.ts
COPY src/ ./src/

# Copy TypeScript config (required by tsx path resolution)
COPY tsconfig.json ./

# Worker does not expose any HTTP ports.
# No EXPOSE directive is intentional.

# Use the npm script defined in package.json
CMD ["npm", "run", "worker"]
