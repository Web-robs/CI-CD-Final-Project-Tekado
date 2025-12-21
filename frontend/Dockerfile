FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
# Root repo uses npm workspaces; disable workspaces for a lean frontend-only install.
RUN npm ci --workspaces=false

COPY public ./public
COPY src ./src
COPY craco.config.js ./

# CRA/CRACO env vars are baked at build time.
ARG REACT_APP_API_BASE_URL
ENV REACT_APP_API_BASE_URL=$REACT_APP_API_BASE_URL

RUN npm run build

FROM nginx:1.27-alpine AS runner

COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
