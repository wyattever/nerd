/**
 * Emulator-backed integration tests for transactDocuments in
 * frontend/lib/server/documents.ts (plan D31, D41).
 *
 * Run (from the repo root, with the Firestore emulator running):
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NERD_FIREBASE_PROJECT_ID=edtech-agent-2026 \
 *     node --experimental-transform-types --import ./tests-ts/support/ts-resolve.mjs \
 *     --test tests-ts/documents-transaction.test.ts
 *
 * Without FIRESTORE_EMULATOR_HOST, one test is registered as skipped and
 * nothing else is loaded. Any host other than 127.0.0.1:8080 fails at once,
 * before documents.ts is imported.
 *
 * WARNING: this writes to REAL document keys (candidate, tracking,
 * added-live, vendors-live) in the EMULATOR. Afterwards, stop the emulator
 * and restart it from emulator-data:
 *   firebase emulators:start --only firestore --import=emulator-data
 * Do not export. The `passwords` document is never read, written or printed.
 */

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const SKIP_MESSAGE =
  "FIRESTORE_EMULATOR_HOST is not set; skipping emulator-backed transactDocuments tests (D41)";
const EXPECTED_HOST = "127.0.0.1:8080";
const EXPECTED_PROJECT = "edtech-agent-2026";
const ACTOR = "test:transactDocuments";
const SEED_ACTOR = "test:seed";

const host = process.env.FIRESTORE_EMULATOR_HOST;

if (host === undefined || host === "") {
  test("transactDocuments (emulator)", { skip: SKIP_MESSAGE }, () => {});
} else if (host !== EXPECTED_HOST) {
  throw new Error(
    `FIRESTORE_EMULATOR_HOST is "${host}"; these tests run only against ${EXPECTED_HOST}. Refusing to load documents.ts.`
  );
} else {
  const documents = await import("../frontend/lib/server/documents.ts");
  const admin = await import("../frontend/lib/server/firebase-admin.ts");
  const { transactDocuments, saveUnguarded, deleteDocument, DocumentTooLargeError } = documents;
  type DocumentKey = import("../frontend/lib/server/documents.ts").DocumentKey;

  const sha = (s: string): string => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
  const bytesFor = (doc: string, v: string): string => `{"test":"step5.2","doc":"${doc}","v":"${v}"}\n`;

  const A = bytesFor("candidate", "A");
  const A2 = bytesFor("candidate", "A2");
  const A3 = bytesFor("candidate", "A3");
  const B = bytesFor("tracking", "B");
  const B2 = bytesFor("tracking", "B2");
  const C = bytesFor("vendors-live", "C");

  const ref = (key: DocumentKey) => admin.db().collection("nerd_documents").doc(key);
  const backupRef = (key: DocumentKey) =>
    admin.db().collection("nerd_documents").doc(key).collection("backups").doc("latest");

  async function seed(key: DocumentKey, bytes: string): Promise<void> {
    await saveUnguarded({ key, bytes, actor: SEED_ACTOR });
  }

  async function makeAbsent(key: DocumentKey): Promise<void> {
    await deleteDocument(key, SEED_ACTOR);
  }

  /** etag and updated_at of `key`, or null when absent. Never returns bytes. */
  async function stamp(key: DocumentKey): Promise<{ etag: string; updated: [number, number] } | null> {
    const snap = await ref(key).get();
    if (!snap.exists) return null;
    const ts = snap.get("updated_at") as { seconds: number; nanoseconds: number };
    return { etag: snap.get("etag") as string, updated: [ts.seconds, ts.nanoseconds] };
  }

  async function storedBytes(key: DocumentKey): Promise<string | null> {
    const snap = await ref(key).get();
    return snap.exists ? (snap.get("bytes") as string) : null;
  }

  async function backupOf(key: DocumentKey): Promise<{ bytes: string; etag: string; replaced_by: string } | null> {
    const snap = await backupRef(key).get();
    if (!snap.exists) return null;
    return {
      bytes: snap.get("bytes") as string,
      etag: snap.get("etag") as string,
      replaced_by: snap.get("replaced_by") as string,
    };
  }

  describe("transactDocuments (emulator)", () => {
    before(() => {
      const projectId = admin.db().projectId;
      console.log(`projectId: ${projectId}`);
      assert.equal(projectId, EXPECTED_PROJECT, "refusing to run against any other project");
    });

    after(async () => {
      await admin.db().terminate();
    });

    test("(a) reads: present and absent documents reach decide; empty plan changes nothing", async () => {
      await seed("candidate", A);
      await makeAbsent("added-live");
      const candidateBefore = await stamp("candidate");
      let seen: [DocumentKey, { bytes: string; etag: string } | null][] = [];
      const result = await transactDocuments({
        keys: ["candidate", "added-live"],
        actor: ACTOR,
        decide: (docs) => {
          seen = [...docs.entries()];
          return { writes: [], deletes: [], result: "result-a" };
        },
      });
      assert.equal(result, "result-a");
      assert.deepEqual(seen, [
        ["candidate", { bytes: A, etag: sha(A) }],
        ["added-live", null],
      ]);
      assert.deepEqual(await stamp("candidate"), candidateBefore);
      assert.equal(await stamp("added-live"), null);
    });

    test("(b) multi-write: two documents change in one call, each with its backup", async () => {
      await seed("candidate", A);
      await seed("tracking", B);
      await transactDocuments({
        keys: ["candidate", "tracking"],
        actor: ACTOR,
        decide: () => ({
          writes: [
            { key: "candidate", bytes: A2 },
            { key: "tracking", bytes: B2 },
          ],
          deletes: [],
          result: null,
        }),
      });
      assert.equal((await stamp("candidate"))?.etag, sha(A2));
      assert.equal((await stamp("tracking"))?.etag, sha(B2));
      assert.equal(await storedBytes("candidate"), A2);
      assert.equal(await storedBytes("tracking"), B2);
      assert.deepEqual(await backupOf("candidate"), { bytes: A, etag: sha(A), replaced_by: ACTOR });
      assert.deepEqual(await backupOf("tracking"), { bytes: B, etag: sha(B), replaced_by: ACTOR });
    });

    test("(c) a write to an absent key creates it with the correct etag", async () => {
      await makeAbsent("candidate");
      assert.equal(await stamp("candidate"), null);
      await transactDocuments({
        keys: ["candidate"],
        actor: ACTOR,
        decide: () => ({ writes: [{ key: "candidate", bytes: A3 }], deletes: [], result: null }),
      });
      assert.equal((await stamp("candidate"))?.etag, sha(A3));
      assert.equal(await storedBytes("candidate"), A3);
    });

    test("(d) deleting a present live key removes it and backs it up", async () => {
      await seed("vendors-live", C);
      await transactDocuments({
        keys: ["vendors-live"],
        actor: ACTOR,
        decide: () => ({ writes: [], deletes: ["vendors-live"], result: null }),
      });
      assert.equal(await stamp("vendors-live"), null);
      assert.deepEqual(await backupOf("vendors-live"), { bytes: C, etag: sha(C), replaced_by: ACTOR });
    });

    test("(e) deleting an absent live key is a no-op", async () => {
      await makeAbsent("added-live");
      const result = await transactDocuments({
        keys: ["added-live"],
        actor: ACTOR,
        decide: () => ({ writes: [], deletes: ["added-live"], result: "result-e" }),
      });
      assert.equal(result, "result-e");
      assert.equal(await stamp("added-live"), null);
    });

    test("(f) atomicity: an oversized write rejects and nothing is written", async () => {
      await seed("candidate", A);
      await seed("tracking", B);
      const candidateBefore = await stamp("candidate");
      const trackingBefore = await stamp("tracking");
      await assert.rejects(
        transactDocuments({
          keys: ["candidate", "tracking"],
          actor: ACTOR,
          decide: () => ({
            writes: [
              { key: "candidate", bytes: A2 },
              { key: "tracking", bytes: "x".repeat(900_001) },
            ],
            deletes: [],
            result: null,
          }),
        }),
        (error: unknown) => error instanceof DocumentTooLargeError
      );
      assert.deepEqual(await stamp("candidate"), candidateBefore);
      assert.deepEqual(await stamp("tracking"), trackingBefore);
    });

    test("(g) a write key not in keys rejects; nothing changes", async () => {
      await seed("candidate", A);
      await seed("tracking", B);
      const candidateBefore = await stamp("candidate");
      const trackingBefore = await stamp("tracking");
      await assert.rejects(
        transactDocuments({
          keys: ["candidate"],
          actor: ACTOR,
          decide: () => ({
            writes: [
              { key: "candidate", bytes: A2 },
              { key: "tracking", bytes: B2 },
            ],
            deletes: [],
            result: null,
          }),
        }),
        /not read/
      );
      assert.deepEqual(await stamp("candidate"), candidateBefore);
      assert.deepEqual(await stamp("tracking"), trackingBefore);
    });

    test("(h) the same key twice in writes rejects; nothing changes", async () => {
      await seed("candidate", A);
      const candidateBefore = await stamp("candidate");
      await assert.rejects(
        transactDocuments({
          keys: ["candidate"],
          actor: ACTOR,
          decide: () => ({
            writes: [
              { key: "candidate", bytes: A2 },
              { key: "candidate", bytes: A3 },
            ],
            deletes: [],
            result: null,
          }),
        }),
        /more than once/
      );
      assert.deepEqual(await stamp("candidate"), candidateBefore);
    });

    test("(i) a delete key not in keys rejects; nothing changes", async () => {
      await seed("candidate", A);
      await seed("vendors-live", C);
      const candidateBefore = await stamp("candidate");
      const liveBefore = await stamp("vendors-live");
      await assert.rejects(
        transactDocuments({
          keys: ["candidate"],
          actor: ACTOR,
          decide: () => ({
            writes: [{ key: "candidate", bytes: A2 }],
            deletes: ["vendors-live"],
            result: null,
          }),
        }),
        /not read/
      );
      assert.deepEqual(await stamp("candidate"), candidateBefore);
      assert.deepEqual(await stamp("vendors-live"), liveBefore);
    });

    test("(j) empty keys and duplicate keys reject", async () => {
      const decide = () => ({ writes: [], deletes: [], result: null });
      await assert.rejects(transactDocuments({ keys: [], actor: ACTOR, decide }), /must not be empty/);
      await assert.rejects(
        transactDocuments({ keys: ["candidate", "candidate"], actor: ACTOR, decide }),
        /duplicate/
      );
    });

    test("(k) decide receives a Map whose iteration order equals keys order", async () => {
      await seed("candidate", A);
      await seed("tracking", B);
      await makeAbsent("added-live");
      await seed("vendors-live", C);
      const keys: DocumentKey[] = ["tracking", "added-live", "candidate", "vendors-live"];
      let order: DocumentKey[] = [];
      await transactDocuments({
        keys,
        actor: ACTOR,
        decide: (docs) => {
          order = [...docs.keys()];
          return { writes: [], deletes: [], result: null };
        },
      });
      assert.deepEqual(order, keys);
    });
  });
}
