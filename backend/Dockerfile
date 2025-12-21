FROM node:20-bookworm-slim AS deps

WORKDIR /app

# Install build tooling for native Node modules (e.g. faiss-node) in the deps stage only.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client inside the image (required at runtime).
# prisma.config.ts requires DATABASE_URL to be set even for generate; a dummy value is sufficient here.
RUN DATABASE_URL=postgresql://user:pass@localhost:5432/db?schema=public /app/node_modules/.bin/prisma generate

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint
RUN chmod +x /usr/local/bin/docker-entrypoint

USER node
EXPOSE 8000

ENTRYPOINT ["docker-entrypoint"]
CMD ["node", "index.js"]
