// frontend/lib/server/firebase-admin.ts
/**
 * The single Firebase Admin App instance for this Next.js server runtime.
 *
 * Everything under lib/server/ is server-only by construction: the
 * `import "server-only"` below turns an accidental import from a Client
 * Component into a BUILD failure rather than a runtime one, which matters
 * more here than anywhere else in the app -- the Admin SDK holds
 * credentials that bypass every security rule, and a client bundle that
 * happened to include it would be a credential leak, not a bug.
 *
 * PROJECT ID IS EXPLICIT AND REQUIRED. It is read from
 * NERD_FIREBASE_PROJECT_ID and nothing else -- deliberately NOT from
 * GOOGLE_CLOUD_PROJECT, which the Admin SDK would otherwise pick up
 * silently. The developer machine this project is built on exports
 * GOOGLE_CLOUD_PROJECT="acp-vertex-core" globally in .zshrc for unrelated
 * tooling; inheriting it here would point every read and write at the
 * wrong database while appearing to work. The failure would be silent and
 * the data loss would be real, so this module throws instead. See
 * docs/DECISION_LOG.md #51.
 *
 * CREDENTIALS are Application Default Credentials in every environment:
 *   - Cloud Run: the service's runtime service account, automatic.
 *   - Local dev: FIRESTORE_EMULATOR_HOST is set, and the Admin SDK skips
 *     credential resolution entirely for Firestore calls. Auth calls
 *     against the emulator likewise need FIREBASE_AUTH_EMULATOR_HOST.
 *   - Local against real cloud (discouraged; see the design doc):
 *     GOOGLE_APPLICATION_CREDENTIALS pointing at an ADC file.
 * No service-account JSON is ever read from the repo or from an env var
 * containing key material.
 */

import "server-only";
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { getAuth, type Auth } from "firebase-admin/auth";

const APP_NAME = "nerd";

function requiredProjectId(): string {
  const projectId = process.env.NERD_FIREBASE_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "NERD_FIREBASE_PROJECT_ID is not set. This is required and is deliberately " +
        "not defaulted to GOOGLE_CLOUD_PROJECT -- see lib/server/firebase-admin.ts."
    );
  }
  return projectId;
}

function app(): App {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;
  return initializeApp({ projectId: requiredProjectId() }, APP_NAME);
}

let firestore: Firestore | null = null;

/** The Firestore handle. Memoized across hot reloads in dev via the
 *  module-level cache plus getApps()'s own de-duplication -- initializing a
 *  second client per request would leak gRPC channels. */
export function db(): Firestore {
  if (firestore) return firestore;
  firestore = getFirestore(app());
  return firestore;
}

export function adminAuth(): Auth {
  return getAuth(app());
}

/** True when this process is pointed at the Firestore emulator. Used only
 *  for diagnostics and for the seed script's safety check -- no code path
 *  branches on it for behavior. */
export function isEmulated(): boolean {
  return Boolean(process.env.FIRESTORE_EMULATOR_HOST);
}
