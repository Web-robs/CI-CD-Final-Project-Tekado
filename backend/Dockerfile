#fast and small to pull from
FROM node:18-alpine  

# Set working directory inside the container
WORKDIR /app

# Install OS dependencies (Prisma needs openssl)
RUN apk add --no-cache openssl

# Set DATABASE_URL so any Prisma-related install/postinstall has it
ENV DATABASE_URL="postgresql://tekado_user:tekado_pass@postgres:5432/tekado_db?schema=public"

# Copy package.json (+ lock file if present)
COPY package*.json ./

# Install only production dependencies
RUN npm install --omit=dev

# Copy Prisma schema and the rest of the app
COPY prisma ./prisma
COPY . .

RUN npx prisma generate

# Runtime env
ENV NODE_ENV=production

# Expose backend port
EXPOSE 8000

# Start the app
CMD ["npm", "start"]
