FROM node:18-slim

WORKDIR /app

# System deps needed for Prisma and native modules (e.g. faiss-node, bcrypt)
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      openssl \
      python3 \
      build-essential \
      cmake \
 && rm -rf /var/lib/apt/lists/*

# Prisma CLI needs DATABASE_URL set at build time for codegen
ENV DATABASE_URL="postgresql://tekado_user:tekado_pass@postgres:5432/tekado_db?schema=public"
ENV NODE_ENV=production
ENV PORT=8000

COPY package*.json ./

# Deterministic install based on lockfile, production deps only
RUN npm ci --omit=dev

# Copy schema first (used by prisma generate) then the rest of the app
COPY prisma ./prisma
COPY . .

RUN npx prisma generate

EXPOSE 8000

CMD ["npm", "start"]
