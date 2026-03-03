# ==================== Stage 1: Dependencies ====================
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ==================== Stage 2: Build ====================
FROM node:20-alpine AS builder
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Prisma generate + Next.js build (disable SSL verification for Prisma binary download)
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
RUN npm run build
ENV NODE_TLS_REJECT_UNAUTHORIZED=1

# ==================== Stage 3: Production ====================
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache tini openssl

# node_modules (including devDeps, as npm run start requires concurrently + tsx)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Next.js build output
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Prisma schema (required for db push)
COPY --from=builder /app/prisma ./prisma

# Worker and Watchdog source code (tsx runs TypeScript)
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/lib ./lib

# Pricing and configuration standards
COPY --from=builder /app/standards ./standards

# Internationalization + configuration files
COPY --from=builder /app/messages ./messages
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/middleware.ts ./middleware.ts
COPY --from=builder /app/postcss.config.mjs ./postcss.config.mjs

# Local storage data directory + empty .env (tsx --env-file=.env requires file to exist, actual env injected by docker-compose)
RUN mkdir -p /app/data/uploads /app/logs && touch /app/.env

EXPOSE 3000 3010

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "run", "start"]
