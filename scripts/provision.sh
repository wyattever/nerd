#!/bin/bash
# scripts/provision.sh -- N.E.R.D. one-time / occasional infrastructure steps.
#
# Moved out of the old scripts/deploy.sh (as of commit 00b11a4) so that a
# routine deploy can never change APIs, IAM, Firestore configuration or
# another service's env. Each step runs ONLY when named on the command line;
# there is no "all". Named steps run in the order given.
#
# USAGE:
#   bash scripts/provision.sh <step> [<step> ...]
#
# STEPS (in the order the old deploy.sh ran them):
#   apis              enable the required Google Cloud APIs
#   repo              create the nerd-repo Artifact Registry repository if missing
#   service-accounts  create nerd-frontend-sa if missing
#   iam               grant the frontend SA roles/datastore.user and roles/firebaseauth.admin
#   firestore         deploy firestore.rules and firestore.indexes.json (firebase CLI)
#
# Every gcloud command passes --project explicitly (and --region or
# --location where it applies). This script never writes the operator's
# gcloud configuration and never reads GOOGLE_CLOUD_PROJECT. Like deploy.sh, it refuses to run
# with emulator or local-mode variables set.

set -euo pipefail

PROJECT_ID="edtech-agent-2026"
REGION="us-central1"

FRONTEND_SA="nerd-frontend-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# ── GUARD: first, before argument parsing or any command ─────────────────────
for guard_var in FIRESTORE_EMULATOR_HOST FIREBASE_AUTH_EMULATOR_HOST LOCAL_MODE NEXT_PUBLIC_DISABLE_AUTH; do
  if [ -n "${!guard_var:-}" ]; then
    echo "Refusing to run: ${guard_var} is set in this environment." >&2
    echo "Emulator and local-mode variables must never reach production provisioning." >&2
    echo "Unset it (unset ${guard_var}) and re-run." >&2
    exit 2
  fi
done

STEPS="apis repo service-accounts iam firestore"

usage() {
  cat <<'USAGE'
Usage: bash scripts/provision.sh <step> [<step> ...]

Each step runs only when named. Steps (old deploy.sh order):
  apis              enable the required Google Cloud APIs
  repo              create the nerd-repo Artifact Registry repository if missing
  service-accounts  create nerd-frontend-sa if missing
  iam               grant the frontend SA roles/datastore.user and roles/firebaseauth.admin
  firestore         deploy Firestore rules and indexes (firebase CLI)
USAGE
}

if [ "$#" -eq 0 ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

# Validate every named step before running any of them.
for step in "$@"; do
  case " ${STEPS} " in
    *" ${step} "*) ;;
    *)
      echo "Unknown step: ${step}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

echo "[target] PRODUCTION -- project ${PROJECT_ID}, region ${REGION}. Steps: $*"

# ── apis (old deploy.sh:82-90) ────────────────────────────────────────────────

step_apis() {
  echo "[apis] Enabling required APIs..."
  gcloud services enable --project "${PROJECT_ID}" \
    run.googleapis.com \
    firestore.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com \
    firebase.googleapis.com \
    iam.googleapis.com \
    --quiet
}

# ── repo (old deploy.sh:92-99) ────────────────────────────────────────────────

step_repo() {
  echo "[repo] Artifact Registry repository..."
  # Create Artifact Registry repo if it doesn't exist
  if ! gcloud artifacts repositories describe nerd-repo --project "${PROJECT_ID}" --location="${REGION}" &>/dev/null; then
    echo "  Creating Artifact Registry repository: nerd-repo..."
    gcloud artifacts repositories create nerd-repo --project "${PROJECT_ID}" \
      --repository-format=docker \
      --location="${REGION}" \
      --description="N.E.R.D. container images"
  fi
}

# ── service-accounts (old deploy.sh:101-117) ──────────────────────────────────
# One identity per service, rather than the project default Compute Engine SA
# both used to inherit. Same describe-then-create shape as the repo above.

step_service_accounts() {
  echo "[service-accounts] Service accounts..."

  if ! gcloud iam service-accounts describe "${FRONTEND_SA}" --project "${PROJECT_ID}" &>/dev/null; then
    echo "  Creating nerd-frontend-sa..."
    gcloud iam service-accounts create nerd-frontend-sa --project "${PROJECT_ID}" \
      --display-name="N.E.R.D. frontend (Cloud Run runtime)"
  fi
}

# ── iam (old deploy.sh:119-157) ───────────────────────────────────────────────

step_iam() {
  # nerd-frontend-sa reads and writes every document in nerd_documents through
  # the Firebase Admin SDK (lib/server/documents.ts), and mints/verifies session
  # cookies (lib/server/session.ts). datastore.user covers the Firestore half.
  echo "[iam] Granting roles/datastore.user to nerd-frontend-sa..."
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" --project "${PROJECT_ID}" \
    --member="serviceAccount:${FRONTEND_SA}" \
    --role="roles/datastore.user" \
    --condition=None \
    --quiet >/dev/null

  # Session-cookie minting (verifyIdToken / createSessionCookie in
  # lib/server/session.ts) requires this role. Without it, sign-in fails with
  # a generic 403 that gives no indication IAM is the cause -- hit live on the
  # first production deploy of a fresh nerd-frontend-sa. See Decision #67.
  echo "[iam] Granting roles/firebaseauth.admin to nerd-frontend-sa..."
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" --project "${PROJECT_ID}" \
    --member="serviceAccount:${FRONTEND_SA}" \
    --role="roles/firebaseauth.admin" \
    --condition=None \
    --quiet >/dev/null

  # NOTE, if sign-in breaks after this change: Decision #61 recorded
  # createSessionCookie() working under ADC WITHOUT an explicit
  # roles/iam.serviceAccountTokenCreator grant -- and flagged that it might not
  # on a fresh environment. A dedicated service account IS a fresh environment.
  # If session-cookie minting starts failing, that grant is the first thing to
  # try:
  #   gcloud iam service-accounts add-iam-policy-binding "${FRONTEND_SA}" --project "${PROJECT_ID}" \
  #     --member="serviceAccount:${FRONTEND_SA}" \
  #     --role="roles/iam.serviceAccountTokenCreator"
  # It is deliberately NOT applied speculatively.
}

# ── firestore (old deploy.sh:159-180) ─────────────────────────────────────────
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

step_firestore() {
  echo "[firestore] Firestore rules and indexes..."
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  ( cd "${repo_root}" && firebase deploy \
    --only firestore:rules,firestore:indexes \
    --project "${PROJECT_ID}" \
    --non-interactive )
}

for step in "$@"; do
  case "${step}" in
    apis) step_apis ;;
    repo) step_repo ;;
    service-accounts) step_service_accounts ;;
    iam) step_iam ;;
    firestore) step_firestore ;;
  esac
done

echo "[done] Steps completed: $*"
