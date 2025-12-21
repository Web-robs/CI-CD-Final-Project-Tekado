# Tekado — DevOps + Architecture Notes

## A) Project Overview
Tekado is a full‑stack e‑commerce app with a React frontend, a Node/Express backend, and a PostgreSQL database accessed through Prisma. The goal of the DevOps setup in this repo is to make the stack reproducible locally (Docker/Compose), deployable on a local Kubernetes cluster (kind), and shippable via CI/CD (GitHub Actions → Docker Hub images).

## DevOps Files In This Repo (Discovery)
- **Docker**
  - Backend image: `backend/Dockerfile`, `backend/docker-entrypoint.sh`, `backend/.dockerignore`
  - Frontend image: `frontend/Dockerfile`, `frontend/nginx.conf`
  - Root ignore: `.dockerignore`
- **Compose**
  - Full stack: `docker-compose.yml`, `docker-compose.prod.yml`
  - DB-only (backend folder): `backend/docker-compose.db.yml`
- **CI/CD**
  - GitHub Actions workflow: `.github/workflows/ci-cd.yml`
- **Kubernetes (kind)**
  - App manifests: `k8s/*.yml`
  - kind cluster config: `k8s/kind/kind-config.yml`
  - Apply helper: `k8s/apply.sh`
- **Monitoring**
  - Prometheus + Grafana manifests: `k8s/monitoring/*.yml`
- **Prisma**
  - Schema and migrations: `backend/prisma/schema.prisma`, `backend/prisma/migrations/`

## B) Architecture & Design Decisions (Justification)

### 1) Container images and structure
- **Because deterministic installs are repeatable**, both images use `npm ci` with lockfiles:
  - Frontend: `frontend/Dockerfile` installs from `package-lock.json`.
  - Backend: `backend/Dockerfile` installs from `backend/package-lock.json` using `npm ci --omit=dev`.
- **Because builds should be fast and cacheable**, Dockerfiles copy only dependency manifests before app source so Docker can reuse layers when code changes.
- **Because the frontend is static**, the frontend uses a multi‑stage build:
  - Stage 1 builds the CRA/CRACO bundle (`npm run build`).
  - Stage 2 serves it with `nginx:1.27-alpine` (small, production web server).
- **Because the backend includes native Node modules**, the backend image uses `node:20-bookworm-slim` (glibc) instead of Alpine (musl), and installs build tooling only in a separate stage (`backend/Dockerfile`).
- **Because secrets must not end up in images**, `.dockerignore` (root + backend) excludes `.env` files, `node_modules`, and build output.
- **Because containers should not run as root**, the backend runtime switches to `USER node` (`backend/Dockerfile`).
- **Because Prisma Client must exist at runtime**, the backend image runs `prisma generate` during build (`backend/Dockerfile`).

### 2) Compose stack layout
- **Because Compose is a simple local orchestrator**, `docker-compose.yml` brings up the full stack with one command and shared networking.
- **Because services must reach each other by name**, Compose uses a named network (`app-net`) so the frontend can reach `backend` and the backend can reach `db`.
- **Because database data must persist**, Postgres stores data in a named volume (`tekado_pgdata`) so data survives container restarts.
- **Because credentials must not be hardcoded in YAML**, Compose reads DB and app secrets from `.env` via `${VAR}` substitutions (see `docker-compose.yml` and `.env.example`).
- **Because DB readiness matters**, Postgres has a healthcheck and backend uses `depends_on: condition: service_healthy` so migrations/startup wait until the DB is ready (`docker-compose.yml`).
- **Because the frontend is static and same‑origin APIs are convenient**, `frontend/nginx.conf` proxies `/api/` to the backend service (`http://backend:8000/api/`).

### 3) Cluster layout (kind)
- **Because we want “real Kubernetes” locally without cloud costs**, kind runs Kubernetes inside Docker, which is ideal for demos and coursework.
- **Because kind has no LoadBalancer by default**, the app uses NodePorts:
  - Backend Service: `k8s/31-backend-service.yml` (NodePort `30081`)
  - Frontend Service: `k8s/41-frontend-service.yml` (NodePort `30080`)
- **Because we want easy access from the laptop**, `k8s/kind/kind-config.yml` maps those NodePorts to host ports:
  - `localhost:8000` → backend NodePort `30081`
  - `localhost:3000` → frontend NodePort `30080`

### 4) Database placement inside Kubernetes
- **Because databases need stable identity and storage**, Postgres is a StatefulSet (`k8s/21-postgres-statefulset.yml`).
- **Because data must survive pod recreation**, the StatefulSet requests a PVC (`volumeClaimTemplates`) for `/var/lib/postgresql/data`.
- **Because StatefulSets benefit from stable DNS**, the database is exposed with a headless Service (`k8s/20-postgres-headless-svc.yml`, `clusterIP: None`) so the backend can use the service name `postgres`.
- **Tradeoff:** this is excellent for local demos and learning, but it’s not a full production HA setup (single replica, no backups configured).

## C) CI/CD Pipeline Reasoning (GitHub Actions)
Workflow file: `.github/workflows/ci-cd.yml`

### Test → Build → Push (3 stages)
- **Test job**
  - Because broken code shouldn’t be built/pushed, tests run first.
  - Uses Node 20 and `npm ci` for deterministic installs.
- **Build job**
  - Because Docker images must build reliably, the workflow builds `backend/Dockerfile` and `frontend/Dockerfile` with Buildx and GHA cache.
  - On pull requests, it builds only (`push: false`) to validate Dockerfiles without publishing.
- **Push job**
  - Because publishing images is a release action, pushes happen only on:
    - `push` to `main`/`master`
    - tags like `v*`

### Secrets + tagging
- **Because credentials must not be committed**, Docker Hub login uses GitHub secrets:
  - `DOCKERHUB_USERNAME`
  - `DOCKERHUB_TOKEN`
- **Because you need traceability**, `docker/metadata-action` tags images with:
  - `latest` (default branch only)
  - short commit SHA
  - git tag (for version tags)
- **Artifacts produced:** Docker images pushed to Docker Hub:
  - `${DOCKERHUB_USERNAME}/tekado-backend`
  - `${DOCKERHUB_USERNAME}/tekado-frontend`
- **How Kubernetes uses them:** `k8s/30-backend-deployment.yml` and `k8s/40-frontend-deployment.yml` reference `${DOCKERHUB_USERNAME}/tekado-*:latest`, and `k8s/apply.sh` substitutes the username at apply time.

## D) Kubernetes Reasoning

### Deployments vs Pods
- **Because the backend/frontend are stateless**, they run as Deployments (`k8s/30-backend-deployment.yml`, `k8s/40-frontend-deployment.yml`).
- **Because Deployments manage rollouts and restarts**, Kubernetes can replace unhealthy pods automatically and scale replicas by changing `spec.replicas`.

### Services and traffic flow
- **Because pods have ephemeral IPs**, Services provide stable names and load-balancing:
  - Backend Service `backend` → selects `app=backend`
  - Frontend Service `frontend` → selects `app=frontend`
- **Because kind doesn’t expose LoadBalancer**, Services are NodePort for easy demo access (`k8s/31-backend-service.yml`, `k8s/41-frontend-service.yml`).

### Readiness vs Liveness probes
- **Because “running” isn’t the same as “ready”**, the backend uses both probes:
  - `readinessProbe` hits `GET /readyz` (only ready when DB is reachable)
  - `livenessProbe` hits `GET /healthz` (process is alive)
  - Configured in `k8s/30-backend-deployment.yml`
- **What happens if a probe fails**
  - Readiness fails → pod stays out of Service endpoints (no traffic).
  - Liveness fails → kubelet restarts the container.

### ConfigMap vs Secret
- **Because not all config is sensitive**, non‑secret values live in a ConfigMap:
  - `k8s/10-configmap.yml` (e.g., `SKIP_SEED_ON_START`, `READYZ_TIMEOUT_MS`)
- **Because credentials must be protected**, secrets live in a Secret:
  - `k8s/11-secret.yml` (DB credentials, `JWT_SECRET`, `DATABASE_URL`)

### Database + migrations
- **Because schema must match the app**, the backend Deployment runs Prisma migrations before starting:
  - `initContainers` runs `prisma migrate deploy` (`k8s/30-backend-deployment.yml`)

## E) Monitoring (Implemented)
Monitoring manifests live in `k8s/monitoring/`.

- **Because you need observability**, the stack uses:
  - Prometheus for scraping/storing metrics.
  - Grafana for dashboards and visualization.
- **Metrics endpoint**
  - Backend exposes Prometheus metrics at `GET /metrics` in `backend/index.js`.
- **How scraping works**
  - Prometheus config (`k8s/monitoring/10-prometheus-configmap.yml`) scrapes:
    - `backend.tekado.svc.cluster.local:8000/metrics`
- **How to access locally (port-forward)**
  - Prometheus: `kubectl -n monitoring port-forward svc/prometheus 9090:9090`
  - Grafana: `kubectl -n monitoring port-forward svc/grafana 3001:3000`

## F) How to Run (Commands + Verification)

### Docker Compose (one command)
1) Create `.env` from `.env.example` and set required values.
2) Start the stack:
```bash
docker compose up --build
```

Verify:
- Frontend: `http://localhost:3001`
- Backend health: `http://localhost:8001/health`

### CI/CD (how to trigger)
- Pull request to `main`/`master` → runs **Test + Build** (no push).
- Push to `main`/`master` → runs **Test + Build + Push**.
- Push tag `v*` (example `v1.0.0`) → runs **Test + Build + Push** with tag-based image tags.

### Kubernetes (kind)
Create cluster (uses host port mappings in `k8s/kind/kind-config.yml`):
```bash
kind create cluster --name tekado --config k8s/kind/kind-config.yml
```

Apply Tekado manifests (substitutes Docker Hub username into image names):
```bash
export DOCKERHUB_USERNAME=your_dockerhub_username
./k8s/apply.sh
```

Verify resources:
```bash
kubectl -n tekado get pods,svc,sts,pvc
kubectl -n tekado rollout status deploy/backend
kubectl -n tekado rollout status deploy/frontend
```

Access:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000/health`

Monitoring:
```bash
kubectl apply -f k8s/monitoring/
kubectl -n monitoring get pods,svc
kubectl -n monitoring port-forward svc/prometheus 9090:9090
kubectl -n monitoring port-forward svc/grafana 3001:3000
```

Verification checklist (end-to-end):
- DB is Running: `kubectl -n tekado get pod postgres-0`
- Backend is Ready: `kubectl -n tekado get pod -l app=backend`
- Frontend is Running: `kubectl -n tekado get pod -l app=frontend`
- UI loads: `http://localhost:3000`
- Login/register works from the UI and data persists in Postgres.

## G) Repo Structure (Key Paths)
```text
.
├─ backend/
│  ├─ Dockerfile
│  ├─ docker-entrypoint.sh
│  ├─ docker-compose.db.yml
│  ├─ index.js
│  ├─ prisma/
│  │  ├─ schema.prisma
│  │  └─ migrations/
│  └─ __tests__/
├─ frontend/
│  ├─ Dockerfile
│  └─ nginx.conf
├─ k8s/
│  ├─ 00-namespace.yml
│  ├─ 10-configmap.yml
│  ├─ 11-secret.yml
│  ├─ 20-postgres-headless-svc.yml
│  ├─ 21-postgres-statefulset.yml
│  ├─ 30-backend-deployment.yml
│  ├─ 31-backend-service.yml
│  ├─ 40-frontend-deployment.yml
│  ├─ 41-frontend-service.yml
│  ├─ apply.sh
│  ├─ kind/kind-config.yml
│  └─ monitoring/
├─ .github/workflows/ci-cd.yml
├─ docker-compose.yml
├─ docker-compose.prod.yml
├─ .dockerignore
└─ .env.example
```
