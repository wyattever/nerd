#!/usr/bin/env python3
"""
write_single_document.py -- writes exactly ONE document to the Firestore
`nerd_documents` collection, replicating scripts/nerd_documents.py's `push`
byte/etag convention exactly (cross-checked against scripts/
scrape_ncademi_live.py's save_live_document(), which independently
replicates the same convention -- both agree; see each file's own docstring)
without push's "always all 9 documents from frontend/lib/" scope.

WHY THIS EXISTS. nerd_documents.py's push always reads frontend/lib/*.json
for all 9 documents in one call -- there is no --source override and no way
to write a single key in isolation. That is fine when frontend/lib/ is the
source of truth for everything. It is NOT fine when only one document needs
a targeted fix and one or more of the OTHER 8 have drifted from production
(e.g. live edits made directly against Firestore, never written back to
frontend/lib/) -- a full push in that state would silently regress them.
This script writes exactly the one document named by --key, from exactly
the one file named by --source, and touches nothing else.

SAFETY

  Dry run by default. Without --yes, this prints what WOULD be written (key,
  byte size, etag, a diff against the CURRENT live document) and writes
  nothing. --yes performs the write. There is no separate emulator/production
  switch here -- --project says which Firestore project every read and write
  in this run targets, same as nerd_documents.py.

  --project is required and GOOGLE_CLOUD_PROJECT is NEVER consulted -- this
  machine exports that variable globally as "acp-vertex-core" for unrelated
  tooling (same reasoning as nerd_documents.py, scrape_ncademi_live.py, and
  frontend/lib/server/firebase-admin.ts). The resolved client is asserted to
  actually match --project before anything is read or written, the same
  guard scrape_ncademi_live.py's firestore_client() applies -- without it, a
  caller with access to the wrong project could have a write silently
  succeed against the wrong Firestore instead of failing loudly.

  --key must be one of the 9 known nerd_documents keys, imported from
  nerd_documents.py's own DOCUMENTS dict rather than redefined here so the
  two can never drift apart. Any other value is rejected by argparse itself
  before touching Firestore.

BYTE/ETAG CONVENTION -- identical to nerd_documents.py's push. The `bytes`
field is the source file's raw bytes, decoded as UTF-8, VERBATIM -- this
script does not re-serialize or reformat the source file in any way, exactly
like push reading frontend/lib/*.json as-is. `etag` is SHA-256 over those
exact raw bytes, hex-encoded. `size_bytes` is the raw byte length. Diverging
on any of these would surface in the editor as spurious 412s that look like
concurrency conflicts.

USAGE

    source venv312/bin/activate

    # Review before writing -- default, no flag needed
    python3 scripts/write_single_document.py --project edtech-agent-2026 \\
      --key added --source .scratch/documents/added.json

    # Perform the write
    python3 scripts/write_single_document.py --project edtech-agent-2026 \\
      --key added --source .scratch/documents/added.json --yes
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import os
import sys
from pathlib import Path

try:
    from google.cloud import firestore
except ImportError:  # pragma: no cover
    sys.exit(
        "google-cloud-firestore is not installed. Activate the project venv first:\n"
        "  source venv312/bin/activate"
    )

# The one list of valid document keys lives in nerd_documents.py -- imported,
# not redefined, so this script can never accept a key push would reject (or
# vice versa). Both files live in scripts/, so this works whether invoked as
# `python3 scripts/write_single_document.py` or `python3
# write_single_document.py` from inside scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from nerd_documents import DOCUMENTS  # noqa: E402

COLLECTION = "nerd_documents"


def etag_of(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def firestore_client(project: str) -> firestore.Client:
    """Pinned explicitly to `project` -- GOOGLE_CLOUD_PROJECT is never
    consulted. Asserts the resolved client actually targets `project`,
    matching scrape_ncademi_live.py's firestore_client() guard exactly:
    without this, a caller who also has access to the wrong project (this
    machine's shell exports GOOGLE_CLOUD_PROJECT=acp-vertex-core globally
    for unrelated tooling) could have a write silently succeed against the
    wrong Firestore instead of failing loudly."""
    client = firestore.Client(project=project)
    if client.project != project:
        raise RuntimeError(
            f"Firestore client resolved project {client.project!r}, expected {project!r}. "
            "Refusing to continue."
        )
    return client


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Write exactly one document to the Firestore nerd_documents collection.",
    )
    parser.add_argument(
        "--project",
        required=True,
        help="GCP project id. Required and never inferred -- GOOGLE_CLOUD_PROJECT is deliberately ignored.",
    )
    parser.add_argument(
        "--key",
        required=True,
        choices=sorted(DOCUMENTS),
        help="Which nerd_documents key to write (imported from nerd_documents.py's DOCUMENTS).",
    )
    parser.add_argument(
        "--source",
        required=True,
        help="Path to the JSON file to write. Read as raw bytes, verbatim -- never re-serialized.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Perform the write. Without it, this is a dry run: nothing is written.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    source_path = Path(args.source)
    if not source_path.exists():
        print(f"ERROR: {source_path} does not exist.", file=sys.stderr)
        return 1

    raw = source_path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as err:
        print(f"ERROR: {source_path} is not valid UTF-8: {err}", file=sys.stderr)
        return 1

    new_etag = etag_of(raw)
    new_size = len(raw)

    client = firestore_client(args.project)
    ref = client.collection(COLLECTION).document(args.key)
    snap = ref.get()
    current_text = snap.get("bytes") if snap.exists else None
    current_etag = snap.get("etag") if snap.exists else None

    print(f"[info] project: {args.project}")
    print(f"[info] key:     {args.key}")
    print(f"[info] source:  {source_path}")
    print()
    print(f"  new etag:      {new_etag}")
    print(f"  new size:      {new_size:,} bytes")
    if snap.exists:
        current_size = len(current_text.encode("utf-8")) if current_text else 0
        print(f"  current etag:  {current_etag}")
        print(f"  current size:  {current_size:,} bytes")
    else:
        print("  current:       document does not exist yet")
    print()

    if snap.exists and current_etag == new_etag:
        print("[info] Source is byte-identical to what is currently stored. Nothing would change.")
    elif current_text is not None and current_text != text:
        print(f"--- diff: {args.key} (current, Firestore) -> {source_path} (new) ---")
        diff = difflib.unified_diff(
            current_text.splitlines(keepends=True),
            text.splitlines(keepends=True),
            fromfile=f"{args.key} (current, Firestore)",
            tofile=str(source_path),
        )
        sys.stdout.writelines(diff)
        print()

    if not args.yes:
        print("[dry run] Nothing written. Re-run with --yes to perform this write.")
        return 0

    ref.set(
        {
            "bytes": text,
            "etag": new_etag,
            "size_bytes": new_size,
            "updated_at": firestore.SERVER_TIMESTAMP,
            "updated_by": f"write_single_document.py:{os.getenv('USER', 'unknown')}",
        }
    )
    print(f"[ok] wrote {args.key} ({new_size:,} bytes, etag {new_etag[:12]})")
    print()
    print("[next] Verify before trusting this:")
    print(f"       python3 scripts/nerd_documents.py verify --project {args.project}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
