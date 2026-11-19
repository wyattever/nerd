#!/bin/bash
# scripts/deploy.sh -- N.E.R.D. Cloud Run deploys, one named service per run.
#
# USAGE (run from anywhere inside the repo):
#   bash scripts/deploy.sh candidate <frontend|api>
#       Build the image from a clean HEAD equal to origin/main, tagged with
#       the git short SHA. Resolve its digest, then deploy by digest with
#       --no-traffic --tag=candidate. Print the candidate URL and the exact
#       promote and rollback commands, then exit. Never shifts traffic.
#   bash scripts/deploy.sh promote <frontend|api> <revision>
#       Route 100% of traffic to <revision>, after the operator types the
#       revision name exactly. Then remove the `candidate` tag and print the
#       rollback command.
#   bash scripts/deploy.sh status <frontend|api>
#       Read-only: serving revision(s), traffic split, tags, image.
#   bash scripts/deploy.sh [-h|--help]
#       This usage.
#
# Infrastructure provisioning (APIs, Artifact Registry repo, service
# accounts, IAM bindings, Firestore rules and indexes, nerd-api FRONTEND_URL)
# lives in scripts/provision.sh, one named step at a time.
#
# DECISIONS (deploy-sh recon 2026-11-19, section C3; all accepted):
#   Q1  Rollback = `promote <service> <previous revision>`; candidate and
#       promote both print it, with the revision that was serving at 100%.
#   Q2  NEXT_PUBLIC_FIREBASE_API_KEY / _APP_ID come from the operator's
#       environment, with the placeholder checks (frontend builds only).
#   Q3  nerd-api has its own candidate/promote path, built by
#       cloudbuild.api.yaml with -f Dockerfile.api (no Dockerfile copy).
#   Q4  This script never sets, updates or removes env vars. No env flags.
#   Q5  KNOWN: nerd-frontend still carries runtime env vars
#       NEXT_PUBLIC_FIREBASE_API_KEY and NEXT_PUBLIC_FIREBASE_APP_ID from an
#       earlier deploy. They are inert (the bundle bakes these at build time)
#       and are deliberately left in place.
#   Q6  The nerd-api FRONTEND_URL patch lives in provision.sh.
#   Q7  All provisioning lives in provision.sh.
#   Q8  The Firestore rules and indexes deploy lives in provision.sh.
#   Q9  candidate requires a clean tree and HEAD == origin/main, after
#       `git fetch origin main`. No override flag.
#   Q10 Refuses to run if FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST,
#       LOCAL_MODE or NEXT_PUBLIC_DISABLE_AUTH is set and non-empty. This is
#       checked before any git or gcloud command.
#   Q11 promote requires the revision name typed exactly. No --yes, no bypass.
#   Q12 promote removes the `candidate` tag after the traffic switch.
#   Q13 Upload contexts: the root .gcloudignore is an allowlist;
#       frontend/.gcloudignore excludes local data.
#   Q14 The unused NEXT_PUBLIC_API_BASE_URL build arg is removed.
#
# Every gcloud command passes --project explicitly (and --region for Cloud
# Run). This script never writes the operator's gcloud configuration and
# never reads GOOGLE_CLOUD_PROJECT.

set -euo pipefail

PROJECT_ID="edtech-agent-2026"
REGION="us-central1"
REPO="us-central1-docker.pkg.dev/${PROJECT_ID}/nerd-repo"

# ── Q10 GUARD: first, before argument parsing, git or gcloud ─────────────────
for guard_var in FIRESTORE_EMULATOR_HOST FIREBASE_AUTH_EMULATOR_HOST LOCAL_MODE NEXT_PUBLIC_DISABLE_AUTH; do
  if [ -n "${!guard_var:-}" ]; then
    echo "Refusing to run: ${guard_var} is set in this environment." >&2
    echo "Emulator and local-mode variables must never reach a production build or deploy." >&2
    echo "Unset it (unset ${guard_var}) and re-run." >&2
    exit 2
  fi
done

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/deploy.sh candidate <frontend|api>
  bash scripts/deploy.sh promote   <frontend|api> <revision>
  bash scripts/deploy.sh status    <frontend|api>

Exactly one service per run. Provisioning: scripts/provision.sh.
USAGE
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

# ── ARGUMENT VALIDATION ───────────────────────────────────────────────────────

if [ "$#" -eq 0 ] || [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

COMMAND="$1"
case "${COMMAND}" in
  candidate|status)
    [ "$#" -eq 2 ] || { usage >&2; exit 2; }
    ;;
  promote)
    [ "$#" -eq 3 ] || { usage >&2; exit 2; }
    ;;
  *)
    echo "Unknown command: ${COMMAND}" >&2
    usage >&2
    exit 2
    ;;
esac

case "$2" in
  frontend|api) SERVICE_KEY="$2" ;;
  *)
    echo "Unknown service: $2 (expected frontend or api)" >&2
    usage >&2
    exit 2
    ;;
esac
SERVICE="nerd-${SERVICE_KEY}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── READ-ONLY HELPERS ─────────────────────────────────────────────────────────

# The service description as JSON (read-only).
describe_service_json() {
  gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --format=json
}

# Reads service JSON on stdin and prints one field:
#   serving    the revision(s) at 100% (or the split), space-separated
#   candidate  "<revision> <url>" of the traffic entry tagged `candidate`
#   summary    a human-readable traffic/tags/image summary
service_field() {
  python3 -c '
import json, sys
field = sys.argv[1]
svc = json.load(sys.stdin)
traffic = svc.get("status", {}).get("traffic", [])
if field == "serving":
    names = [t.get("revisionName", "") for t in traffic if t.get("percent", 0) > 0]
    print(" ".join(n for n in names if n))
elif field == "candidate":
    for t in traffic:
        if t.get("tag") == "candidate":
            print(t.get("revisionName", ""), t.get("url", ""))
            break
elif field == "summary":
    print("service:", svc.get("metadata", {}).get("name"))
    print("traffic:")
    for t in traffic:
        print("  revision={} percent={} tag={} latest={}".format(
            t.get("revisionName"), t.get("percent", 0), t.get("tag"), t.get("latestRevision", False)))
    image = svc.get("spec", {}).get("template", {}).get("spec", {}).get("containers", [{}])[0].get("image")
    print("template image:", image)
    print("latest ready revision:", svc.get("status", {}).get("latestReadyRevisionName"))
    print("url:", svc.get("status", {}).get("url"))
' "$1"
}

# ── status ────────────────────────────────────────────────────────────────────

cmd_status() {
  describe_service_json | service_field summary
}

# ── candidate ─────────────────────────────────────────────────────────────────

cmd_candidate() {
  # Q2: frontend build values from the environment, checked before any work.
  # Values are never printed.
  if [ "${SERVICE_KEY}" = "frontend" ]; then
    for v in NEXT_PUBLIC_FIREBASE_API_KEY NEXT_PUBLIC_FIREBASE_APP_ID; do
      if [ -z "${!v:-}" ] || [ "${!v}" = "PLACEHOLDER_FROM_FIREBASE_CONSOLE" ]; then
        die "${v} is not set or is still a placeholder. Export it before running a frontend candidate."
      fi
      # Firebase web config values are [A-Za-z0-9:_-]. Anything else (a URL,
      # a host:port, a comma that would split --substitutions) is refused.
      if ! [[ "${!v}" =~ ^[A-Za-z0-9:_-]+$ ]]; then
        die "${v} contains characters outside [A-Za-z0-9:_-]; refusing to pass it to the build."
      fi
    done
  fi

  # Q9: a clean tree, and HEAD equal to origin/main. No override.
  cd "${REPO_ROOT}"
  git fetch --quiet origin main
  local head origin_main
  head="$(git rev-parse HEAD)"
  origin_main="$(git rev-parse origin/main)"
  if [ "${head}" != "${origin_main}" ]; then
    die "HEAD (${head:0:12}) is not origin/main (${origin_main:0:12}). Candidates are built only from a pushed main."
  fi
  if [ -n "$(git status --porcelain)" ]; then
    git status --short >&2
    die "The working tree is not clean (including untracked files). Commit, stash or remove them first."
  fi

  local tag
  tag="$(git rev-parse --short HEAD)"

  echo "[target] project ${PROJECT_ID}, region ${REGION}, service ${SERVICE}, commit ${tag}"

  # Recorded before the deploy, for the rollback command (Q1).
  local previous
  previous="$(describe_service_json | service_field serving)"

  # Build. The image is tagged with the git short SHA.
  if [ "${SERVICE_KEY}" = "frontend" ]; then
    gcloud builds submit "${REPO_ROOT}/frontend" --project "${PROJECT_ID}" \
      --config "${REPO_ROOT}/frontend/cloudbuild.yaml" \
      --substitutions "_FIREBASE_API_KEY=${NEXT_PUBLIC_FIREBASE_API_KEY},_FIREBASE_APP_ID=${NEXT_PUBLIC_FIREBASE_APP_ID},_REPO=${REPO},_TAG=${tag}" \
      --quiet
  else
    gcloud builds submit "${REPO_ROOT}" --project "${PROJECT_ID}" \
      --config "${REPO_ROOT}/cloudbuild.api.yaml" \
      --substitutions "_REPO=${REPO},_TAG=${tag}" \
      --quiet
  fi

  # Resolve the tag to a digest (read-only) and deploy by digest.
  local digest
  digest="$(gcloud artifacts docker images describe "${REPO}/${SERVICE}:${tag}" --project "${PROJECT_ID}" \
    --format='value(image_summary.digest)')"
  [[ "${digest}" =~ ^sha256:[0-9a-f]{64}$ ]] || die "Could not resolve a digest for ${REPO}/${SERVICE}:${tag}."

  # Q4: no env flags. Service account, ingress and auth settings are inherited
  # from the existing service.
  gcloud run deploy "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" \
    --image "${REPO}/${SERVICE}@${digest}" \
    --no-traffic \
    --tag=candidate \
    --quiet

  local cand cand_rev cand_url
  cand="$(describe_service_json | service_field candidate)"
  cand_rev="${cand%% *}"
  cand_url="${cand#* }"
  [ -n "${cand_rev}" ] || die "Deployed, but no traffic entry is tagged candidate. Check: bash scripts/deploy.sh status ${SERVICE_KEY}"

  echo ""
  echo "==> Candidate deployed (0% traffic)."
  echo "    service:            ${SERVICE}"
  echo "    image:              ${REPO}/${SERVICE}@${digest}"
  echo "    candidate revision: ${cand_rev}"
  echo "    candidate URL:      ${cand_url}"
  echo "    currently serving:  ${previous:-<none>}"
  echo ""
  echo "    Check the candidate URL, then promote:"
  echo "      bash scripts/deploy.sh promote ${SERVICE_KEY} ${cand_rev}"
  if [ -n "${previous}" ] && [ "${previous}" = "${previous%% *}" ]; then
    echo "    Rollback (after promoting), back to the revision serving now:"
    echo "      bash scripts/deploy.sh promote ${SERVICE_KEY} ${previous}"
  else
    echo "    Rollback: traffic is currently split (${previous:-none}); see: bash scripts/deploy.sh status ${SERVICE_KEY}"
  fi
}

# ── promote ───────────────────────────────────────────────────────────────────

cmd_promote() {
  local target="$3"
  if ! [[ "${target}" =~ ^${SERVICE}-[0-9]{5}-[a-z0-9]{3}$ ]]; then
    die "\"${target}\" is not a ${SERVICE} revision name (expected ${SERVICE}-NNNNN-xxx)."
  fi

  # Read-only checks before the prompt.
  local ready
  ready="$(gcloud run revisions describe "${target}" --project "${PROJECT_ID}" --region "${REGION}" \
    --format='value(status.conditions[0].type,status.conditions[0].status)')"
  [ "${ready}" = "Ready	True" ] || die "Revision ${target} is not Ready (got: ${ready:-nothing})."

  local previous
  previous="$(describe_service_json | service_field serving)"

  echo "[target] project ${PROJECT_ID}, region ${REGION}, service ${SERVICE}"
  echo "    currently serving: ${previous:-<none>}"
  echo "    promote to:        ${target} (100%)"
  echo ""
  # Q11: typed confirmation, exact match, no bypass.
  local typed=""
  read -r -p "Type the revision name to confirm: " typed || true
  if [ "${typed}" != "${target}" ]; then
    die "Confirmation did not match. Nothing was changed."
  fi

  gcloud run services update-traffic "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" \
    --to-revisions="${target}=100"

  # Q12: remove the candidate tag once traffic has moved.
  gcloud run services update-traffic "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" \
    --remove-tags=candidate

  echo ""
  echo "==> ${SERVICE} now serves ${target} at 100%; candidate tag removed."
  describe_service_json | service_field summary
  if [ -n "${previous}" ] && [ "${previous}" = "${previous%% *}" ] && [ "${previous}" != "${target}" ]; then
    echo ""
    echo "    Rollback:"
    echo "      bash scripts/deploy.sh promote ${SERVICE_KEY} ${previous}"
  fi
}

case "${COMMAND}" in
  candidate) cmd_candidate ;;
  status) cmd_status ;;
  promote) cmd_promote "$@" ;;
esac
