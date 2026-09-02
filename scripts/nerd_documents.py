#!/usr/bin/env python3
"""
nerd_documents.py -- move the six (plus three live-snapshot) JSON documents
between frontend/lib/ and the Firestore `nerd_documents` collection.

ONE TOOL, TWO JOBS, DELIBERATELY.

  `push` against the Firestore EMULATOR is how a developer seeds their
  local environment. `push` against the real project is the production
  migration. They are the same code path with a different target.

That is the point. A migration script that runs exactly once, in anger,
against real data, has been tested exactly zero times. This one is exercised
every time anyone sets up or resets a local environment, so by the time it
touches production it is the most-run script in the repo. The cost is a
deliberate constraint on the local workflow (the emulator has to be running);
the benefit is that the riskiest step of the whole migration is routine.

  push    frontend/lib/*.json  ->  Firestore
  pull    Firestore            ->  files (default: .scratch/, NOT frontend/lib/)
  verify  compare hashes on both sides without writing anything
  list    show what is stored, with sizes and timestamps

ETAG COMPATIBILITY

The stored `etag` is SHA-256 over the exact file bytes, hex-encoded --
byte-for-byte what lib/local-write.ts computed from disk and what
lib/server/documents.ts computes from the stored string. A document
migrated by this script therefore keeps the ETag it had as a file, which
makes `verify` a real integrity check rather than a re-read of whatever was
just written.

SAFETY

  - Writing to a NON-emulator target requires --project AND --yes. There is
    no way to migrate production by accident.
  - `pull` writes to .scratch/ by default. Overwriting frontend/lib/ requires
    --dest with an explicit path. Those files are the source of truth until
    the migration is signed off, and a stray pull must not be able to clobber
    them.
  - GOOGLE_CLOUD_PROJECT is never consulted. The shell on this machine
    exports it globally as `acp-vertex-core` for unrelated tooling.

USAGE

    source venv312/bin/activate

    # Local: start the emulator first, in another terminal
    #   firebase emulators:start --only firestore
    FIRESTORE_EMULATOR_HOST=localhost:8080 \\
      python3 scripts/nerd_documents.py push --project nerd-local

    # Verify a real project without writing
    python3 scripts/nerd_documents.py verify --project edtech-agent-2026

    # Production migration
    python3 scripts/nerd_documents.py push --project edtech-agent-2026 --yes

PRECONDITION FOR ANY NON-EMULATOR PUSH: the single-field index exemption on
`nerd_documents.bytes` must already be applied, or every write fails with
INVALID_ARGUMENT ("longer than 1500 bytes"). See firestore.indexes.json.
This script checks for that failure and reports it explicitly rather than
letting the traceback speak for itself.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from google.cloud import firestore
    from google.api_core import exceptions as gexc
except ImportError:  # pragma: no cover
    sys.exit(
        "google-cloud-firestore is not installed. Activate the project venv first:\n"
        "  source venv312/bin/activate"
    )

REPO_ROOT = Path(__file__).resolve().parent.parent
LIB_DIR = REPO_ROOT / "frontend" / "lib"
SCRATCH_DIR = REPO_ROOT / ".scratch" / "documents"

COLLECTION = "nerd_documents"

# Firestore rejects a commit whose largest un-indexed field value exceeds
# 1,048,487 bytes. Guarded well below that so the error is this message
# rather than an opaque INVALID_ARGUMENT. Mirrors MAX_DOCUMENT_BYTES in
# frontend/lib/server/documents.ts -- keep the two in step.
MAX_DOCUMENT_BYTES = 900_000

# document key -> source filename. Order is the migration order; the four
# ETag-guarded documents go first so a partial run leaves the editor's core
# documents complete rather than half-populated.
DOCUMENTS: dict[str, str] = {
    "published": "published.json",
    "added": "added.json",
    "candidate": "candidate.json",
    "vendors": "vendors.json",
    "tracking": "tracking.json",
    "passwords": "passwords.json",
    "published-live": "published-live.json",
    "added-live": "added-live.json",
    "vendors-live": "vendors-live.json",
}

# Absent is normal for these -- a live snapshot exists only between a scrape
# and its promote, and tracking/passwords may not have been created yet.
OPTIONAL = {"tracking", "passwords", "published-live", "added-live", "vendors-live"}


def etag_of(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def client_for(project: str) -> firestore.Client:
    return firestore.Client(project=project)


def is_emulated() -> bool:
    return bool(os.getenv("FIRESTORE_EMULATOR_HOST"))


def target_description(project: str) -> str:
    host = os.getenv("FIRESTORE_EMULATOR_HOST")
    return f"EMULATOR at {host} (project {project})" if host else f"REAL PROJECT {project}"


def read_source(key: str) -> bytes | None:
    path = LIB_DIR / DOCUMENTS[key]
    if not path.exists():
        return None
    return path.read_bytes()


# --------------------------------------------------------------------------
# push
# --------------------------------------------------------------------------


def cmd_push(args: argparse.Namespace) -> int:
    if not is_emulated() and not args.yes:
        print(
            f"Refusing to write to {target_description(args.project)} without --yes.\n"
            "Re-run with --yes if this is the intended production migration.",
            file=sys.stderr,
        )
        return 2

    client = client_for(args.project)
    actor = args.actor or f"nerd_documents.py:{os.getenv('USER', 'unknown')}"

    print(f"[info] target: {target_description(args.project)}")
    print(f"[info] actor:  {actor}")
    print()

    written: list[tuple[str, str, int]] = []
    skipped: list[str] = []

    for key in DOCUMENTS:
        raw = read_source(key)
        if raw is None:
            if key in OPTIONAL:
                print(f"  skip   {key:<16} (no {DOCUMENTS[key]} -- expected)")
                skipped.append(key)
                continue
            print(f"  ERROR  {key:<16} {DOCUMENTS[key]} not found", file=sys.stderr)
            return 1

        # Validate before writing. A syntactically broken document that
        # reaches Firestore would break every read of it, and a whole-file
        # store gives the app no way to route around one bad record.
        try:
            json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as err:
            print(f"  ERROR  {key:<16} {DOCUMENTS[key]} is not valid JSON: {err}", file=sys.stderr)
            return 1

        if len(raw) > MAX_DOCUMENT_BYTES:
            print(
                f"  ERROR  {key:<16} {len(raw)} bytes exceeds the {MAX_DOCUMENT_BYTES}-byte limit",
                file=sys.stderr,
            )
            return 1

        text = raw.decode("utf-8")
        etag = etag_of(raw)

        if args.dry_run:
            print(f"  would  {key:<16} {len(raw):>8,} bytes  {etag[:12]}")
            written.append((key, etag, len(raw)))
            continue

        ref = client.collection(COLLECTION).document(key)
        try:
            ref.set(
                {
                    "bytes": text,
                    "etag": etag,
                    "size_bytes": len(raw),
                    "updated_at": firestore.SERVER_TIMESTAMP,
                    "updated_by": actor,
                }
            )
        except gexc.InvalidArgument as err:
            if "1500 bytes" in str(err):
                print(
                    f"\n  ERROR  {key}: Firestore rejected the write because the `bytes` field "
                    "is indexed.\n"
                    "         The single-field index exemption has not been applied to this "
                    "database.\n"
                    "         Apply it and re-run:\n"
                    "           gcloud beta firestore indexes fields update bytes \\\n"
                    "             --collection-group=nerd_documents --database='(default)' "
                    "--disable-indexes\n"
                    "         See firestore.indexes.json.",
                    file=sys.stderr,
                )
                return 1
            raise

        print(f"  wrote  {key:<16} {len(raw):>8,} bytes  {etag[:12]}")
        written.append((key, etag, len(raw)))

    print()
    verb = "would write" if args.dry_run else "wrote"
    print(f"[ok] {verb} {len(written)} document(s); skipped {len(skipped)}")

    if not args.dry_run:
        print()
        print("[next] Verify before trusting this:")
        print(f"       python3 scripts/nerd_documents.py verify --project {args.project}")
    return 0


# --------------------------------------------------------------------------
# verify
# --------------------------------------------------------------------------


def cmd_verify(args: argparse.Namespace) -> int:
    client = client_for(args.project)
    print(f"[info] target: {target_description(args.project)}")
    print()

    ok = True
    for key in DOCUMENTS:
        raw = read_source(key)
        snap = client.collection(COLLECTION).document(key).get()

        if raw is None and not snap.exists:
            print(f"  --     {key:<16} absent on both sides")
            continue
        if raw is None:
            print(f"  EXTRA  {key:<16} in Firestore but no local {DOCUMENTS[key]}")
            if key not in OPTIONAL:
                ok = False
            continue
        if not snap.exists:
            print(f"  MISS   {key:<16} local file exists, not in Firestore")
            ok = False
            continue

        local = etag_of(raw)
        stored = snap.get("etag")
        stored_bytes = snap.get("bytes")
        recomputed = etag_of(stored_bytes.encode("utf-8"))

        if stored != recomputed:
            print(
                f"  CORRUPT {key:<15} stored etag does not match stored bytes "
                f"({stored[:12]} vs {recomputed[:12]})"
            )
            ok = False
        elif local != stored:
            print(f"  DIFFER {key:<16} local {local[:12]} != stored {stored[:12]}")
            ok = False
        else:
            print(f"  match  {key:<16} {stored[:12]}  {snap.get('size_bytes'):>8,} bytes")

    print()
    if ok:
        print("[PASS] every document present on both sides is byte-identical.")
        return 0
    print("[FAIL] see differences above.")
    return 1


# --------------------------------------------------------------------------
# pull
# --------------------------------------------------------------------------


def cmd_pull(args: argparse.Namespace) -> int:
    dest = Path(args.dest).resolve() if args.dest else SCRATCH_DIR
    if dest == LIB_DIR and not args.yes:
        print(
            "Refusing to overwrite frontend/lib/ without --yes. Those files are the "
            "source of truth until the migration is signed off.",
            file=sys.stderr,
        )
        return 2

    client = client_for(args.project)
    dest.mkdir(parents=True, exist_ok=True)

    print(f"[info] source: {target_description(args.project)}")
    print(f"[info] dest:   {dest}")
    print()

    count = 0
    for key in DOCUMENTS:
        snap = client.collection(COLLECTION).document(key).get()
        if not snap.exists:
            print(f"  skip   {key:<16} not in Firestore")
            continue
        raw = snap.get("bytes").encode("utf-8")
        (dest / DOCUMENTS[key]).write_bytes(raw)
        print(f"  pulled {key:<16} {len(raw):>8,} bytes -> {DOCUMENTS[key]}")
        count += 1

    print()
    print(f"[ok] pulled {count} document(s)")
    return 0


# --------------------------------------------------------------------------
# list
# --------------------------------------------------------------------------


def cmd_list(args: argparse.Namespace) -> int:
    client = client_for(args.project)
    print(f"[info] target: {target_description(args.project)}")
    print()
    print(f"  {'key':<18}{'bytes':>10}  {'etag':<14}{'updated_at':<28}updated_by")
    print(f"  {'-' * 18}{'-' * 10}  {'-' * 14}{'-' * 28}{'-' * 20}")

    found = 0
    for doc in client.collection(COLLECTION).stream():
        data = doc.to_dict() or {}
        updated = data.get("updated_at")
        stamp = (
            updated.astimezone(timezone.utc).isoformat()
            if isinstance(updated, datetime)
            else str(updated)
        )
        print(
            f"  {doc.id:<18}{data.get('size_bytes', 0):>10,}  "
            f"{str(data.get('etag', ''))[:12]:<14}{stamp:<28}{data.get('updated_by', '')}"
        )
        found += 1

    print()
    print(f"[ok] {found} document(s) in {COLLECTION}")
    return 0


# --------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--project",
        required=True,
        help=(
            "GCP project id. Required and never inferred -- GOOGLE_CLOUD_PROJECT is "
            "deliberately ignored. Any value works when FIRESTORE_EMULATOR_HOST is set."
        ),
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_push = sub.add_parser("push", help="frontend/lib/*.json -> Firestore")
    p_push.add_argument("--yes", action="store_true", help="required for a non-emulator target")
    p_push.add_argument("--dry-run", action="store_true", help="report what would be written")
    p_push.add_argument("--actor", help="value recorded in updated_by")
    p_push.set_defaults(func=cmd_push)

    p_verify = sub.add_parser("verify", help="compare hashes, write nothing")
    p_verify.set_defaults(func=cmd_verify)

    p_pull = sub.add_parser("pull", help="Firestore -> files")
    p_pull.add_argument("--dest", help="destination directory (default .scratch/documents/)")
    p_pull.add_argument("--yes", action="store_true", help="required to write into frontend/lib/")
    p_pull.set_defaults(func=cmd_pull)

    p_list = sub.add_parser("list", help="show stored documents")
    p_list.set_defaults(func=cmd_list)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
