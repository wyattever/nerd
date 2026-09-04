#!/bin/bash
# scripts/deploy.sh — N.E.R.D. Phase 5 Deployment Script
# Provisions infrastructure and deploys the two Cloud Run services:
#   nerd-api       the Python parse service (private)
#   nerd-frontend  the Next.js app (public)
# Run from project root: bash scripts/deploy.sh --prod
# Prerequisites: gcloud CLI authenticated, firebase CLI authenticated,
#   Firestore in Native mode initialized.

set -euo pipefail

PROJECT_ID="edtech-agent-2026"
REGION="us-central1"
REPO="us-central1-docker.pkg.dev/${PROJECT_ID}/nerd-repo"

FRONTEND_SA="nerd-frontend-sa@${PROJECT_ID}.iam.gserviceaccount.com"
API_SA="nerd-api-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# ── PRODUCTION GUARD ──────────────────────────────────────────────────────────
# Everything below touches the real project. There is no emulator path and no
# dry run, so the only protection is refusing to start without an explicit
# --prod. Same stance as scripts/scrape_ncademi_live.py: fail fast, before any
# work, rather than part-way through a multi-minute deploy.

PROD=0
for arg in "$@"; do
  case "${arg}" in
    --prod) PROD=1 ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      echo "Usage: bash scripts/deploy.sh --prod" >&2
      exit 2
      ;;
  esac
done

if [ "${PROD}" -ne 1 ]; then
  echo "Refusing to run: this script deploys to the REAL ${PROJECT_ID} project" >&2
  echo "in ${REGION}. There is no staging target and no dry run." >&2
  echo "" >&2
  echo "  to deploy:  bash scripts/deploy.sh --prod" >&2
  exit 2
fi

# ── OPERATOR INPUT CHECKS ─────────────────────────────────────────────────────
# All of these are checked BEFORE the first gcloud call. A container build that
# runs for minutes and only then discovers a missing variable is strictly worse
# than a fast failure.

if [ -z "${NEXT_PUBLIC_FIREBASE_API_KEY:-}" ] || [ "${NEXT_PUBLIC_FIREBASE_API_KEY}" = "PLACEHOLDER_FROM_FIREBASE_CONSOLE" ]; then
  echo "  ERROR: NEXT_PUBLIC_FIREBASE_API_KEY is not set or is still a placeholder." >&2
  echo "  Set it before running deploy.sh: export NEXT_PUBLIC_FIREBASE_API_KEY=your_key" >&2
  exit 1
fi

if [ -z "${NEXT_PUBLIC_FIREBASE_APP_ID:-}" ] || [ "${NEXT_PUBLIC_FIREBASE_APP_ID}" = "PLACEHOLDER_FROM_FIREBASE_CONSOLE" ]; then
  echo "  ERROR: NEXT_PUBLIC_FIREBASE_APP_ID is not set or is still a placeholder." >&2
  exit 1
fi

# The sign-in allowlist. Deliberately NOT hardcoded here: it is the list of
# humans who can use the deployed app, and it changes independently of this
# script. lib/server/session.ts fails CLOSED -- an empty or unset list denies
# everyone, including whoever is running this deploy.
if [ -z "${NERD_ALLOWED_EMAILS:-}" ]; then
  echo "  ERROR: NERD_ALLOWED_EMAILS is not set." >&2
  echo "  Comma-separated sign-in allowlist. lib/server/session.ts fails closed:" >&2
  echo "  deploying with this unset locks everyone out of the app." >&2
  echo "  Example: export NERD_ALLOWED_EMAILS=\"a@example.com,b@example.com\"" >&2
  exit 1
fi

echo "==> N.E.R.D. Phase 5 Deployment"
echo "[target] PRODUCTION -- project ${PROJECT_ID}, region ${REGION}."
echo ""

# ── 0. PRE-FLIGHT ─────────────────────────────────────────────────────────────

echo "[0] Pre-flight..."
gcloud config set project "${PROJECT_ID}"

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  firebase.googleapis.com \
  iam.googleapis.com \
  --quiet

# Create Artifact Registry repo if it doesn't exist
if ! gcloud artifacts repositories describe nerd-repo --location="${REGION}" &>/dev/null; then
  echo "  Creating Artifact Registry repository: nerd-repo..."
  gcloud artifacts repositories create nerd-repo \
    --repository-format=docker \
    --location="${REGION}" \
    --description="N.E.R.D. container images"
fi

# ── 1. SERVICE ACCOUNTS ───────────────────────────────────────────────────────
# One identity per service, rather than the project default Compute Engine SA
# both used to inherit. Same describe-then-create shape as the repo above.

echo "[1] Service accounts..."

if ! gcloud iam service-accounts describe "${FRONTEND_SA}" &>/dev/null; then
  echo "  Creating nerd-frontend-sa..."
  gcloud iam service-accounts create nerd-frontend-sa \
    --display-name="N.E.R.D. frontend (Cloud Run runtime)"
fi

if ! gcloud iam service-accounts describe "${API_SA}" &>/dev/null; then
  echo "  Creating nerd-api-sa..."
  gcloud iam service-accounts create nerd-api-sa \
    --display-name="N.E.R.D. Python parse service (Cloud Run runtime)"
fi

# nerd-frontend-sa reads and writes every document in nerd_documents through
# the Firebase Admin SDK (lib/server/documents.ts), and mints/verifies session
# cookies (lib/server/session.ts). datastore.user covers the Firestore half.
echo "  Granting roles/datastore.user to nerd-frontend-sa..."
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${FRONTEND_SA}" \
  --role="roles/datastore.user" \
  --condition=None \
  --quiet >/dev/null

# NOTE, if sign-in breaks after this change: Decision #61 recorded
# createSessionCookie() working under ADC WITHOUT an explicit
# roles/iam.serviceAccountTokenCreator grant -- and flagged that it might not
# on a fresh environment. A dedicated service account IS a fresh environment.
# If session-cookie minting starts failing, that grant is the first thing to
# try:
#   gcloud iam service-accounts add-iam-policy-binding "${FRONTEND_SA}" \
#     --member="serviceAccount:${FRONTEND_SA}" \
#     --role="roles/iam.serviceAccountTokenCreator"
# It is deliberately NOT applied speculatively.

# nerd-api-sa gets NO project-level roles. The service touches exactly one
# Google Cloud resource: a Firestore get() in /healthz (api/main.py, via
# api/store.py's AsyncClient) against a document that does not exist. That
# probe is the only reason it reaches Firestore at all. Everything else it does
# -- parsing markdown, checking link liveness over plain HTTP -- needs no GCP
# permission. If /healthz's Firestore probe is ever dropped, this SA needs
# nothing whatsoever.

# ── 2. FIRESTORE RULES AND INDEXES ────────────────────────────────────────────
# Runs BEFORE any service deploy, because the index configuration is a hard
# precondition for the app functioning at all.
#
# firestore.indexes.json declares single-field index EXEMPTIONS on
# nerd_documents.bytes and backups.bytes. Firestore indexes every field
# automatically and rejects any commit whose indexed value exceeds 1,500 bytes
# with INVALID_ARGUMENT. The `bytes` field holds a whole JSON document -- 9 KB
# to 128 KB -- so without these exemptions EVERY write of EVERY document fails,
# including the initial migration. This is not tuning; it is load-bearing.
#
# firestore.rules is deny-all by design (see its header): all access is via the
# Admin SDK, which bypasses rules entirely.
#
# --project is explicit: .firebaserc aliases `prod` but declares no `default`,
# so `firebase deploy` with no project flag would fail to resolve a target.

echo "[2] Firestore rules and indexes..."
firebase deploy \
  --only firestore:rules,firestore:indexes \
  --project "${PROJECT_ID}" \
  --non-interactive

# ── 3. BUILD AND DEPLOY API ───────────────────────────────────────────────────

echo "[3] Building and deploying API..."
cp Dockerfile.api Dockerfile
gcloud builds submit \
  --tag "${REPO}/nerd-api" \
  --quiet
rm Dockerfile

# --no-allow-unauthenticated: nothing in a browser ever calls nerd-api. The
# only caller is frontend/app/api/ingest/draft/route.ts, a server-side Route
# Handler that mints a Google-signed OIDC identity token for this service's
# audience (frontend/lib/server/gcp-identity.ts, via the instance metadata
# server) and sends it as a Bearer token. Cloud Run IAM is therefore the
# authentication boundary, and the frontend SA's roles/run.invoker below is
# what makes that call succeed.
#
# NERD_FIREBASE_PROJECT_ID is REQUIRED: api/store.py raises at import if it is
# unset, so the container will not start without it. It pins the Firestore
# client explicitly rather than letting AsyncClient() resolve from
# GOOGLE_CLOUD_PROJECT -- see that file and DECISION_LOG.md #66.
gcloud run deploy nerd-api \
  --image "${REPO}/nerd-api" \
  --platform managed \
  --region "${REGION}" \
  --service-account "${API_SA}" \
  --no-allow-unauthenticated \
  --memory 2Gi \
  --max-instances 1 \
  --update-env-vars="GCP_LOCATION=${REGION},GOOGLE_CLOUD_PROJECT=${PROJECT_ID},NERD_FIREBASE_PROJECT_ID=${PROJECT_ID}"

API_URL=$(gcloud run services describe nerd-api \
  --platform managed --region "${REGION}" \
  --format "value(status.url)")
echo "  API deployed: ${API_URL}"

# Scoped to this ONE service, not granted project-wide.
echo "  Granting roles/run.invoker on nerd-api to nerd-frontend-sa..."
gcloud run services add-iam-policy-binding nerd-api \
  --platform managed \
  --region "${REGION}" \
  --member="serviceAccount:${FRONTEND_SA}" \
  --role="roles/run.invoker" \
  --quiet >/dev/null

# ── 4. BUILD AND DEPLOY FRONTEND ──────────────────────────────────────────────

echo "[4] Building and deploying FRONTEND..."
# NEXT_PUBLIC_* values are inlined into the JS bundle at BUILD time, so they are
# passed as build args here and NOT set at runtime below -- setting them on the
# service would have no effect on the shipped bundle.
( cd frontend && gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions="_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY},_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID},_REPO=${REPO}" \
  --quiet )

# --update-env-vars, never --set-env-vars. --set-env-vars REPLACES the whole
# environment, which would wipe every variable below that a previous deploy or
# a manual fix had set.
#
# All four are read on the SERVER at runtime and are required:
#   NERD_FIREBASE_PROJECT_ID   lib/server/firebase-admin.ts THROWS if unset; it
#                              deliberately refuses to fall back to
#                              GOOGLE_CLOUD_PROJECT.
#   NERD_ALLOWED_EMAILS        lib/server/session.ts fails CLOSED; unset denies
#                              every sign-in.
#   NERD_PY_SERVICE_URL        base URL of nerd-api, no trailing slash
#                              (app/api/ingest/draft/route.ts).
#   NERD_PY_SERVICE_AUDIENCE   the OIDC `aud` claim nerd-api will require. For
#                              Cloud Run this is that service's own base URL,
#                              so it matches the line above; kept separate
#                              because they diverge behind a custom domain.
gcloud run deploy nerd-frontend \
  --image "${REPO}/nerd-frontend" \
  --platform managed \
  --region "${REGION}" \
  --service-account "${FRONTEND_SA}" \
  --allow-unauthenticated \
  --update-env-vars="^;^NERD_FIREBASE_PROJECT_ID=${PROJECT_ID};NERD_ALLOWED_EMAILS=${NERD_ALLOWED_EMAILS};NERD_PY_SERVICE_URL=${API_URL};NERD_PY_SERVICE_AUDIENCE=${API_URL}" \
  --no-traffic \
  --tag=candidate

FRONTEND_URL=$(gcloud run services describe nerd-frontend \
  --platform managed --region "${REGION}" \
  --format "value(status.url)")
echo "  Frontend deployed: ${FRONTEND_URL}"

echo "[4b] Patching nerd-api with resolved FRONTEND_URL..."
gcloud run services update nerd-api \
  --platform managed \
  --region "${REGION}" \
  --update-env-vars="FRONTEND_URL=${FRONTEND_URL}"
echo "  nerd-api FRONTEND_URL set to: ${FRONTEND_URL}"

# ── 4c. PROMOTE FRONTEND TRAFFIC ─────────────────────────────────────────────
# Additive: 4 (above) deploys the new revision with --no-traffic --tag=candidate;
# this step routes 100% of traffic to it. Comment out 4c for an
# inspect-the-candidate-before-promoting workflow.
echo "[4c] Promoting nerd-frontend traffic to the latest revision..."
gcloud run services update-traffic nerd-frontend \
  --platform managed \
  --region "${REGION}" \
  --to-latest
echo "  nerd-frontend traffic promoted to latest revision."

# ── 5. SUMMARY ────────────────────────────────────────────────────────────────

echo ""
echo "==> Deployment Complete"
echo "    API:      ${API_URL}  (private, OIDC only)"
echo "    Frontend: ${FRONTEND_URL}"
echo ""
echo "    Post-deploy checklist:"
echo "    [ ] Update Firebase Auth > Authorized Domains: add ${FRONTEND_URL}"
echo "    [ ] Confirm sign-in works for an address in NERD_ALLOWED_EMAILS"
echo "    [ ] Confirm Import Data works (proves the frontend's OIDC token is"
echo "        accepted by nerd-api)"
echo "    [ ] Firestore rules stay deny-all. They are not a gap: every read and"
echo "        write goes through the Admin SDK, which bypasses rules entirely."
echo "        Do NOT loosen them to 'let the service account in' -- the service"
echo "        account was never subject to them."
