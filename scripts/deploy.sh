#!/bin/bash
# scripts/deploy.sh — N.E.R.D. Phase 4 Deployment Script
# Provisions infrastructure and deploys all three Cloud Run services.
# Run from project root: bash scripts/deploy.sh
# Prerequisites: gcloud CLI authenticated, Artifact Registry repo created,
#   Firestore in Native mode initialized, Cloud Tasks API enabled.

set -e

PROJECT_ID="edtech-agent-2026"
REGION="us-central1"
REPO="us-central1-docker.pkg.dev/${PROJECT_ID}/nerd-repo"

echo "==> N.E.R.D. Phase 4 Deployment: ${PROJECT_ID}"
echo ""

# ── 0. PRE-FLIGHT CHECKS ──────────────────────────────────────────────────────

echo "[0] Pre-flight checks..."
gcloud config set project "${PROJECT_ID}"

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
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
  --memory 2Gi \
  --max-instances 1 \
  --update-env-vars="GCP_LOCATION=${REGION},GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
  --set-secrets="GEMINI_API_KEY=gemini-api-key:latest"

API_URL=$(gcloud run services describe nerd-api \
  --platform managed --region "${REGION}" \
  --format "value(status.url)")
echo "  API deployed: ${API_URL}"

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

echo "[7b] Patching nerd-api with resolved FRONTEND_URL..."
gcloud run services update nerd-api \
  --platform managed \
  --region "${REGION}" \
  --update-env-vars="FRONTEND_URL=${FRONTEND_URL}"
echo "  nerd-api FRONTEND_URL set to: ${FRONTEND_URL}"

# ── 7c. PROMOTE FRONTEND TRAFFIC ─────────────────────────────────────────────
# Additive: 7 (above) deploys the new revision with --no-traffic --tag=candidate;
# this step routes 100% of traffic to it. Comment out 7c for an
# inspect-the-candidate-before-promoting workflow.
echo "[7c] Promoting nerd-frontend traffic to the latest revision..."
gcloud run services update-traffic nerd-frontend \
  --platform managed \
  --region "${REGION}" \
  --to-latest
echo "  nerd-frontend traffic promoted to latest revision."


# ── 8. SUMMARY ────────────────────────────────────────────────────────────────

echo ""
echo "==> Deployment Complete"
echo "    API:      ${API_URL}"
echo "    Frontend: ${FRONTEND_URL}"
echo ""
echo "    Post-deploy checklist:"
echo "    [ ] Update Firebase Auth > Authorized Domains: add ${FRONTEND_URL}"
echo "    [ ] Verify Firestore rules allow nerd-api service account read/write"
echo "    [ ] Confirm API is live: curl ${API_URL}/healthz"