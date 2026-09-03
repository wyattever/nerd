import "server-only";

import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// projectId is pinned explicitly: Application Default Credentials in this
// environment resolve to the wrong GCP project (acp-vertex-core), so relying on
// ADC's project inference would read/write the wrong Firestore. The credential
// still comes from ADC; only the project is forced to edtech-agent-2026.
const PROJECT_ID = "edtech-agent-2026";

const app =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({
        credential: applicationDefault(),
        projectId: PROJECT_ID,
      });

export const db = getFirestore(app);
