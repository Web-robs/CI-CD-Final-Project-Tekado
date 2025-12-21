# Tekado

Full‑stack e‑commerce demo with React frontend, Node/Express + Prisma backend, and PostgreSQL.

## Contents
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Docker (Production)](#docker-production)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Architecture
- **Frontend:** React (CRA + CRACO), Material UI, Axios client to backend API.
- **Backend:** Node.js/Express, Prisma ORM, PostgreSQL, Prometheus metrics on `/metrics`, Swagger docs on `/api-docs`.
- **Database:** PostgreSQL (local or managed instance).

## Repository Layout
- `src/` — React frontend.
- `backend/` — Express API and Prisma schema.

## Prerequisites
- Node.js 18+
- npm
- PostgreSQL 14+ (local install or managed)

## Environment Variables
Top-level `.env` (frontend):
```
REACT_APP_API_BASE_URL=http://localhost:8000/api
REACT_APP_SKIP_CARD_VALIDATION=true   # set to false to enforce card validation in UI
```

Backend `backend/.env` (example):
```
DATABASE_URL=postgresql://tekado_user:tekado_pass@localhost:5432/tekado_db?schema=public
JWT_SECRET=change_me
SKIP_CARD_VALIDATION=true             # set to false to enforce validation server-side
```
Also see `.env.example` for optional services (Weaviate, SMTP, etc.).

## Local Development
```bash
# Install dependencies
npm install
(cd backend && npm install)

# Ensure Postgres is running locally and DATABASE_URL points to it

# Apply Prisma migrations
cd backend
npx prisma migrate deploy
npx prisma generate
cd ..

# Run backend (port 8000)
cd backend && npm start
# In a new terminal: run frontend (port 3000)
cd .. && npm start
```

## Docker (Production)
This repo includes production-ready containers for:
- **Backend** (Express + Prisma) on `:8000`
- **Frontend** (CRA/CRACO static build via Nginx) on `:3000`
- **PostgreSQL** on `:5433` by default (named volume persists data; override with `POSTGRES_HOST_PORT=5432`)

### Run full stack
1) Create a local `.env` (not committed) from `.env.example` and set at least:
```bash
JWT_SECRET=change_me
POSTGRES_PASSWORD=change_me
```

2) Build + start:
```bash
docker compose up --build
```

Use the more explicit “prod-ish” file if you prefer:
```bash
docker compose -f docker-compose.prod.yml up --build
```

### Migrations (recommended)
`docker-compose.prod.yml` runs `prisma migrate deploy` automatically on backend start (`RUN_MIGRATIONS=true`).

To run it manually:
```bash
docker compose -f docker-compose.prod.yml exec backend /app/node_modules/.bin/prisma migrate deploy
```

### Verify login/register end-to-end
- Frontend: `http://localhost:3000`
- Backend healthcheck: `http://localhost:8000/health`
- Backend Swagger: `http://localhost:8000/api-docs`
 - DB (optional): `localhost:${POSTGRES_HOST_PORT:-5433}`

Register/login calls:
- `POST http://localhost:8000/api/auth/register`
- `POST http://localhost:8000/api/auth/login`

## Testing
Backend:
```bash
cd backend
npm test
```
Frontend:
```bash
npm test
```

## Troubleshooting
- API unreachable from frontend: verify `REACT_APP_API_BASE_URL` and backend is listening on `0.0.0.0:8000`.
- DB errors: confirm Postgres is up and `DATABASE_URL` is correct.
- Card validation blocking: set `SKIP_CARD_VALIDATION=true` (backend) and `REACT_APP_SKIP_CARD_VALIDATION=true` (frontend) for demos.
 - Docker build fails on native modules (e.g. `faiss-node`): the backend image uses Debian (`node:20-bookworm-slim`) to avoid Alpine/musl incompatibilities.

### Prisma Studio: "Can't reach database server at `localhost:5432`"
Prisma Studio connects to whatever `DATABASE_URL` points at (see `backend/.env`). If you haven’t started PostgreSQL locally, you’ll get this error.

Options:
- **Start PostgreSQL via Docker (recommended):**
```bash
cd backend
docker compose -f docker-compose.db.yml up -d db
```
- **Or start PostgreSQL locally** (ensure it’s listening on `localhost:5432`), then create the user/db from `backend/.env`:
  - `tekado_user` / `tekado_pass`
  - `tekado_db`
- **Or point to a different Postgres** by updating `DATABASE_URL` (host/port/credentials).

After the DB is reachable:
```bash
cd backend
npx prisma migrate deploy
npx prisma generate
npx prisma studio
```
