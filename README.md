# Tekado

Enterprise-ready full‑stack e‑commerce demo with React frontend, Node/Express + Prisma backend, PostgreSQL, Docker, Kubernetes, GitHub Actions CI/CD, and Prometheus/Grafana monitoring.

## Contents
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Local Development (no containers)](#local-development-no-containers)
- [Docker Compose (backend + Postgres)](#docker-compose-backend--postgres)
- [Build Docker Image](#build-docker-image)
- [Kubernetes Deployment](#kubernetes-deployment)
- [Monitoring (Prometheus + Grafana)](#monitoring-prometheus--grafana)
- [GitHub Actions CI/CD](#github-actions-cicd)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Architecture
- **Frontend:** React (CRA + CRACO), Material UI, Axios client to backend API.
- **Backend:** Node.js/Express, Prisma ORM, PostgreSQL, Prometheus metrics on `/metrics`, Swagger docs on `/api-docs`.
- **Database:** PostgreSQL (containerized; StatefulSet in Kubernetes).
- **CI/CD:** GitHub Actions with three jobs (test → build → push) publishing a backend image.
- **Runtime options:** Local dev, Docker Compose, Kubernetes.
- **Observability:** Prometheus scraping backend metrics; Grafana dashboard provided.

## Repository Layout
- `src/` — React frontend.
- `backend/` — Express API, Prisma schema, Dockerfile.
- `docker-compose.yml` — Postgres + backend for quick local run.
- `kubernetes/` — Manifests for backend, Postgres, config/secret.
- `kubernetes/monitoring/` — Prometheus, Grafana, sample dashboard JSON.
- `.github/workflows/ci-cd.yml` — GitHub Actions pipeline (test/build/push).

## Prerequisites
- Node.js 18+
- npm
- Docker + Docker Compose
- kubectl + a Kubernetes cluster/context (for k8s)
- Access to a container registry (Docker Hub by default)

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

## Local Development (no containers)
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

## Docker Compose (backend + Postgres)
```bash
# From repo root
docker compose up -d

# Check containers
docker compose ps

# Logs
docker compose logs -f backend
```
Compose exposes API on `localhost:8000` and Postgres on `localhost:5432`.

## Build Docker Image
Backend image build (same context used by CI):
```bash
cd backend
docker build -t your-dockerhub-user/tekado-backend:latest .
```

## Kubernetes Deployment
Create namespace (once):
```bash
kubectl create namespace tekado
```

Apply configs/secrets and services:
```bash
kubectl apply -n tekado -f kubernetes/tekado-config.yaml
kubectl apply -n tekado -f kubernetes/db-secret.yaml
kubectl apply -n tekado -f kubernetes/postgres-statefulset.yaml
kubectl apply -n tekado -f kubernetes/postgres-service.yaml
kubectl apply -n tekado -f kubernetes/backend-deployment.yaml
kubectl apply -n tekado -f kubernetes/backend-service.yaml
```
> Make sure the image in `kubernetes/backend-deployment.yaml` uses the same registry/tag you build and push (e.g., `${DOCKERHUB_USERNAME}/tekado-backend:latest`).

Access backend (port-forward):
```bash
kubectl -n tekado port-forward svc/tekado-backend 8000:8000
# API: http://localhost:8000/api , Health: /health , Metrics: /metrics , Swagger: /api-docs
```

Rollout restart after pushing a new image:
```bash
kubectl -n tekado rollout restart deployment/tekado-backend
```

## Monitoring (Prometheus + Grafana)
Deploy monitoring stack:
```bash
kubectl apply -n tekado -f kubernetes/monitoring/prometheus-configmap.yaml
kubectl apply -n tekado -f kubernetes/monitoring/prometheus-deployment.yaml
kubectl apply -n tekado -f kubernetes/monitoring/grafana-deployment.yaml
```

Port-forward UIs:
```bash
kubectl -n tekado port-forward svc/prometheus 9090:9090
kubectl -n tekado port-forward svc/grafana 3000:3000
# Prometheus: http://localhost:9090
# Grafana:    http://localhost:3000 (admin/admin by default)
```

Import dashboard:
- In Grafana, “Dashboards” → “Import” → upload `kubernetes/monitoring/Tekado - Monitoring-1764508708105.json`.

## GitHub Actions CI/CD
Workflow: `.github/workflows/ci-cd.yml`
- Triggers: `push` and `pull_request` on `main`.
- Jobs:
  - `test`: runs backend tests.
  - `build`: builds Docker image (no push).
  - `push`: builds and pushes Docker image (requires secrets, runs after `build`).

Required secrets:
- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Resulting image tag: `${DOCKERHUB_USERNAME}/tekado-backend:latest`.
After CI push, restart the k8s deployment to pull the new image (see command above).

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
- DB errors: confirm Postgres is up; check `DATABASE_URL`; for Compose, host is `localhost` outside containers and `db` inside.
- Card validation blocking: set `SKIP_CARD_VALIDATION=true` (backend) and `REACT_APP_SKIP_CARD_VALIDATION=true` (frontend) for demos.
- Prometheus shows no targets: ensure backend annotations are present in `backend-deployment.yaml` and service DNS `tekado-backend.tekado.svc.cluster.local:8000` resolves in cluster.
