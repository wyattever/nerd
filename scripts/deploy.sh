#!/bin/bash
# scripts/deploy.sh — N.E.R.D. Phase 4 Deployment Script
# Provisions infrastructure and deploys all three Cloud Run services.
# Run from project root: bash scripts/deploy.sh
# Prerequisites: gcloud CLI authenticated, Artifact Registry repo created,
#   Firestore in Native mode initialized, Cloud Tasks API enabled.

set -e

PROJECT_ID="edtech-agent-2026"
REGION="us-central1"
QUEUE_NAME="nerd-research-queue"
REPO="us-central1-docker.pkg.dev/${PROJECT_ID}/nerd-repo"

# Service account used by Cloud Tasks to invoke the worker
TASKS_SA="nerd-tasks-invoker@${PROJECT_ID}.iam.gserviceaccount.com"

echo "==> N.E.R.D. Phase 4 Deployment: ${PROJECT_ID}"
echo ""

# ── 0. PRE-FLIGHT CHECKS ──────────────────────────────────────────────────────

echo "[0] Pre-flight checks..."
gcloud config set project "${PROJECT_ID}"

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  firestore.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  firebase.googleapis.com \
  --quiet

# Create Artifact Registry repo if it doesn't exist
if ! gcloud artifacts repositories describe nerd-repo --location="${REGION}" &>/dev/null; then
  echo "  Creating Artifact Registry repository: nerd-repo..."
  gcloud artifacts repositories create nerd-repo \
    --repository-format=docker \
    --location="${REGION}" \
    --description="N.E.R.D. container images"
fi

# ── 1. CLOUD TASKS QUEUE ──────────────────────────────────────────────────────

echo "[1] Provisioning Cloud Tasks queue..."
if ! gcloud tasks queues describe "${QUEUE_NAME}" --location="${REGION}" &>/dev/null; then
  gcloud tasks queues create "${QUEUE_NAME}" \
    --location="${REGION}" \
    --max-concurrent-dispatches=10 \
    --max-attempts=1
  echo "  Created queue: ${QUEUE_NAME}"
else
  echo "  Queue already exists: ${QUEUE_NAME}"
fi

# ── 2. FIRESTORE ───────────────────────────────────────────────────────────────

echo "[2] Firestore..."
# Firestore must be initialized in Native mode via Console or:
# gcloud firestore databases create --location=us-central1
# (Can only be done once per project; skip if already exists)
echo "  Confirm Firestore Native mode is initialized in ${PROJECT_ID}."

# Create TTL policy on nerd_research_jobs to auto-expire old jobs after 24h
# This field 'expires_at' is now populated by api/job_store.py
echo "  Enabling Firestore TTL on nerd_research_jobs(expires_at)..."
gcloud firestore fields ttls update expires_at \
  --collection-group=nerd_research_jobs \
  --project="${PROJECT_ID}" --enable-ttl || echo "  Warning: Failed to enable TTL. Ensure Firestore is in Native mode."

# ── 3. SERVICE ACCOUNT FOR CLOUD TASKS → WORKER INVOCATION ───────────────────

echo "[3] Cloud Tasks service account..."
if ! gcloud iam service-accounts describe "${TASKS_SA}" &>/dev/null; then
  gcloud iam service-accounts create nerd-tasks-invoker \
    --display-name="N.E.R.D. Cloud Tasks Invoker"
  echo "  Created service account: ${TASKS_SA}"
else
  echo "  Service account already exists: ${TASKS_SA}"
fi

# ── 4. SECRET MANAGER ─────────────────────────────────────────────────────────

echo "[4] Secret Manager..."
# GEMINI_API_KEY is used by both API and Worker for AI operations.
if ! gcloud secrets describe gemini-api-key &>/dev/null; then
  echo "  Creating placeholder 'gemini-api-key' secret..."
  echo "PLACEHOLDER_KEY" | gcloud secrets create gemini-api-key --data-file=-
else
  echo "  Secret 'gemini-api-key' already exists."
fi

# Store Firebase Web API Key for server-side use (e.g., firebase-admin in Phase 5)

echo "[5] Building and deploying WORKER..."
cp Dockerfile.worker Dockerfile
gcloud builds submit \
  --tag "${REPO}/nerd-worker" \
  --quiet
rm Dockerfile

gcloud run deploy nerd-worker \
  --image "${REPO}/nerd-worker" \
  --platform managed \
  --region "${REGION}" \
  --no-allow-unauthenticated \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 10 \
  --timeout 300 \
  --set-env-vars="ENABLE_AI_INSIGHTS=true,GOOGLE_CLOUD_PROJECT=${PROJECT_ID}"

WORKER_URL=$(gcloud run services describe nerd-worker \
  --platform managed --region "${REGION}" \
  --format "value(status.url)")
echo "  Worker deployed: ${WORKER_URL}"

# Grant Cloud Tasks SA permission to invoke the worker
gcloud run services add-iam-policy-binding nerd-worker \
  --member="serviceAccount:${TASKS_SA}" \
  --role="roles/run.invoker" \
  --region="${REGION}"

# Update Cloud Tasks queue to use the service account for OIDC auth
gcloud tasks queues update "${QUEUE_NAME}" \
  --location="${REGION}" \
  --log-sampling-ratio=1.0

echo "  IAM: Cloud Tasks SA granted invoker role on nerd-worker."

# ── 6. BUILD AND DEPLOY API ───────────────────────────────────────────────────

echo "[6] Building and deploying API..."
cp Dockerfile.api Dockerfile
gcloud builds submit \
  --tag "${REPO}/nerd-api" \
  --quiet
rm Dockerfile

gcloud run deploy nerd-api \
  --image "${REPO}/nerd-api" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --set-env-vars="WORKER_URL=${WORKER_URL},QUEUE_NAME=${QUEUE_NAME},GCP_LOCATION=${REGION},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},TASKS_SA=${TASKS_SA}" \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest"

API_URL=$(gcloud run services describe nerd-api \
  --platform managed --region "${REGION}" \
  --format "value(status.url)")
echo "  API deployed: ${API_URL}"

# Grant API Service Account permission to act as the Cloud Tasks SA
# (Required to create tasks with an OIDC token)
API_SA=$(gcloud run services describe nerd-api \
  --platform managed --region "${REGION}" \
  --format "value(spec.template.spec.serviceAccountName)")
# If no custom SA is set, it uses the default compute SA
if [ -z "${API_SA}" ] || [ "${API_SA}" = "default" ]; then
  PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
  API_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
fi

echo "  Granting ${API_SA} actAs permission on ${TASKS_SA}..."
gcloud iam service-accounts add-iam-policy-binding "${TASKS_SA}" \
  --member="serviceAccount:${API_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --quiet

# ── 7. BUILD AND DEPLOY FRONTEND ──────────────────────────────────────────────

echo "[7] Building and deploying FRONTEND..."
# NEXT_PUBLIC_ vars must be available at build time (baked into JS bundle)
# Pass them as build args or set them before running this script:
# export NEXT_PUBLIC_FIREBASE_API_KEY=your_key
# export NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

if [ -z "${NEXT_PUBLIC_FIREBASE_API_KEY}" ] || [ "${NEXT_PUBLIC_FIREBASE_API_KEY}" = "PLACEHOLDER_FROM_FIREBASE_CONSOLE" ]; then
  echo "  ERROR: NEXT_PUBLIC_FIREBASE_API_KEY is not set or is still a placeholder."
  echo "  Set it before running deploy.sh: export NEXT_PUBLIC_FIREBASE_API_KEY=your_key"
  exit 1
fi

if [ -z "${NEXT_PUBLIC_FIREBASE_APP_ID}" ] || [ "${NEXT_PUBLIC_FIREBASE_APP_ID}" = "PLACEHOLDER_FROM_FIREBASE_CONSOLE" ]; then
  echo "  ERROR: NEXT_PUBLIC_FIREBASE_APP_ID is not set or is still a placeholder."
  exit 1
fi

cd frontend
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions="_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY},_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID},_NEXT_PUBLIC_API_BASE_URL=${API_URL},_REPO=${REPO}" \
  --quiet
cd ..

gcloud run deploy nerd-frontend \
  --image "${REPO}/nerd-frontend" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --set-env-vars="NEXT_PUBLIC_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY},NEXT_PUBLIC_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID}" \
  --no-traffic \
  --tag=candidate

FRONTEND_URL=$(gcloud run services describe nerd-frontend \
  --platform managed --region "${REGION}" \
  --format "value(status.url)")
echo "  Frontend deployed: ${FRONTEND_URL}"

# ── 8. SUMMARY ────────────────────────────────────────────────────────────────

echo ""
echo "==> Deployment Complete"
echo "    Worker:   ${WORKER_URL}"
echo "    API:      ${API_URL}"
echo "    Frontend: ${FRONTEND_URL}"
echo ""
echo "    Post-deploy checklist:"
echo "    [ ] Update Firebase Auth > Authorized Domains: add ${FRONTEND_URL}"
echo "    [ ] Verify Firestore rules allow nerd-api service account read/write"
echo "    [ ] Run E2E test: curl -X POST ${API_URL}/research/initial ..."
echo "    [ ] Confirm API is live: curl ${API_URL}/admin/candidates"
