#!/usr/bin/env bash
set -euo pipefail

: "${DOCKERHUB_USERNAME:?Set DOCKERHUB_USERNAME (e.g. export DOCKERHUB_USERNAME=yourname)}"

kubectl apply -f k8s/00-namespace.yml

kubectl apply -f k8s/10-configmap.yml
kubectl apply -f k8s/11-secret.yml
kubectl apply -f k8s/20-postgres-headless-svc.yml
kubectl apply -f k8s/21-postgres-statefulset.yml

envsubst '${DOCKERHUB_USERNAME}' < k8s/30-backend-deployment.yml | kubectl apply -f -
kubectl apply -f k8s/31-backend-service.yml

envsubst '${DOCKERHUB_USERNAME}' < k8s/40-frontend-deployment.yml | kubectl apply -f -
kubectl apply -f k8s/41-frontend-service.yml

echo "Applied Tekado k8s manifests to namespace 'tekado'."

