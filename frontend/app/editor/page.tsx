// frontend/app/editor/page.tsx
"use client";

/**
 * Visual editor for published-tables.json -- a lightweight parallel to the
 * legacy AppSheet-candidate main page (app/page.tsx), scoped to editing the
 * live published-site snapshot instead. Deliberately NOT a duplicate of
 * that 1000+ line page or its AppSheet-specific pieces: no ResearcherTable,
 * no ImportDataModal, no AppSheet fetching.
 *
 * Data comes from the same local-only write API the /tables/published JSON
 * editor uses (see lib/local-write.ts and JSON-Editor-validation.md),
 * fetched client-side on mount -- this page has no Server Component data
 * loader, so "fresh from disk" is the only read path, not a fallback.
 *
 * Three documents, one page: published-tables.json, added-tables.json, and
 * candidate-tables.json are fetched concurrently on mount via
 * Promise.allSettled -- each settles independently, so a rejected
 * added/candidate fetch degrades that one tab to an empty list rather than
 * blocking the page or the published tab. fileMeta tracks each document's
 * own $schema_version/$meta/ETag separately (three distinct files, three
 * distinct ETags), keyed by the same SourceTab union EditorSidebar uses.
 *
 * activeTab lives here, not in EditorSidebar, and is passed down as a
 * controlled prop: handleSaveToServer needs to know which tab is active to
 * pick the right /api/local/* endpoint, the right in-memory product array,
 * and the right entry in fileMeta; handleActiveTabChange also needs it to
 * reset the selection to that tab's own first record. It also drives the
 * page's own <h1> ("Published/Added/Candidate Products Editor"). A single
 * source of truth rather than several copies that could drift.
 *
 * selected/listing (and every field editor's save handler) resolve against
 * activeProducts -- whichever array activeTab points at -- not hardcoded to
 * the published array. That is what actually makes added/candidate records
 * selectable and editable, not just visible in the sidebar:
 * setActiveProducts below routes each edit's setState call to the matching
 * top-level array (setProducts/setAddedProducts/setCandidateProducts)
 * based on activeTab, so editing a selected added or candidate record
 * updates the array it actually lives in.
 *
 * Two-column layout, sized for a wide desktop window rather than
 * responsively: EditorSidebar is a fixed-width, self-sticking left column
 * (product source tabs, filter, and the scrollable list itself -- replaces
 * the old top-bar <select>); the right-hand content column carries a hard
 * min-w-[1200px] so the preview never squishes on a narrower viewport. The
 * outer wrapper has no max-width, so the page can grow past 1200px+320px
 * freely rather than being centered in a fixed band.
 *
 * "Save" persists the ACTIVE TAB's in-memory array, mirroring
 * PublishedJsonWorkbench.tsx's save flow: POST the whole document
 * ({ $schema_version, $meta, products }) to that tab's /api/local/*
 * endpoint with its own current ETag in If-Match, wrapped in useTransition.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ListingCard } from "@/components/ListingCard";
import { EditorSidebar, type SourceTab } from "@/components/EditorSidebar";
import { PublishedHeaderEditor, type HeaderFields } from "@/components/PublishedHeaderEditor";
import { PublishedVendorResourcesEditor } from "@/components/PublishedVendorResourcesEditor";
import { PublishedOtherResourcesEditor } from "@/components/PublishedOtherResourcesEditor";
import { PublishedSupportEditor } from "@/components/PublishedSupportEditor";
import { PublishedAcrEditor } from "@/components/PublishedAcrEditor";
import type { SnapshotMeta } from "@/components/PublishedJsonWorkbench";
import { toListingData } from "@/lib/editor-preview";
import type {
  PublishedAcrReport,
  PublishedProductRecord,
  PublishedResourceLink,
  PublishedSupportContact,
} from "@/lib/published-tables";

/** Tracks whether the PUBLISHED tab's initial fetch has settled -- the tab
 *  that gates the preview/edit UI by default. added/candidate degrade to an
 *  empty array on failure without moving this flag; see the file header. */
type LoadState = "loading" | "ready" | "unavailable";

interface FileMeta {
  schemaVersion: number | null;
  meta: SnapshotMeta | null;
  etag: string | null;
}

const EMPTY_FILE_META: FileMeta = { schemaVersion: null, meta: null, etag: null };

const ENDPOINT_FOR_TAB: Record<SourceTab, string> = {
  published: "/api/local/published",
  added: "/api/local/added",
  candidate: "/api/local/candidate",
};

interface FetchedDocument {
  products: PublishedProductRecord[];
  schemaVersion: number | null;
  meta: SnapshotMeta | null;
  etag: string | null;
}

async function fetchDocument(url: string): Promise<FetchedDocument> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}`);
  const etag = res.headers.get("ETag");
  const body = (await res.json()) as {
    $schema_version?: unknown;
    $meta?: unknown;
    products?: unknown;
  };
  return {
    products: Array.isArray(body.products) ? (body.products as PublishedProductRecord[]) : [],
    schemaVersion: typeof body.$schema_version === "number" ? body.$schema_version : null,
    meta: body.$meta ? (body.$meta as SnapshotMeta) : null,
    etag,
  };
}

export default function EditorPage() {
  const [activeTab, setActiveTab] = useState<SourceTab>("published");

  const [products, setProducts] = useState<PublishedProductRecord[]>([]);
  const [addedProducts, setAddedProducts] = useState<PublishedProductRecord[]>([]);
  const [candidateProducts, setCandidateProducts] = useState<PublishedProductRecord[]>([]);
  const [fileMeta, setFileMeta] = useState<Record<SourceTab, FileMeta>>({
    published: EMPTY_FILE_META,
    added: EMPTY_FILE_META,
    candidate: EMPTY_FILE_META,
  });

  const [selectedSlug, setSelectedSlug] = useState("");
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [statusMessage, setStatusMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, startSaveTransition] = useTransition();
  const [isHeaderEditorOpen, setIsHeaderEditorOpen] = useState(false);
  const [isVendorResourcesEditorOpen, setIsVendorResourcesEditorOpen] = useState(false);
  const [isOtherResourcesEditorOpen, setIsOtherResourcesEditorOpen] = useState(false);
  const [isSupportEditorOpen, setIsSupportEditorOpen] = useState(false);
  const [isAcrEditorOpen, setIsAcrEditorOpen] = useState(false);

  const editHeaderButtonRef = useRef<HTMLButtonElement>(null);
  const editVendorResourcesButtonRef = useRef<HTMLButtonElement>(null);
  const editOtherResourcesButtonRef = useRef<HTMLButtonElement>(null);
  const editSupportButtonRef = useRef<HTMLButtonElement>(null);
  const editAcrButtonRef = useRef<HTMLButtonElement>(null);

  // Fresh, concurrent fetch on mount -- see file header. Each of the three
  // settles independently: a rejected added/candidate fetch (expected today
  // -- those files don't exist on disk yet) degrades that one tab to an
  // empty array rather than failing the page or the published tab.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [publishedResult, addedResult, candidateResult] = await Promise.allSettled([
        fetchDocument(ENDPOINT_FOR_TAB.published),
        fetchDocument(ENDPOINT_FOR_TAB.added),
        fetchDocument(ENDPOINT_FOR_TAB.candidate),
      ]);
      if (cancelled) return;

      if (publishedResult.status === "fulfilled") {
        const doc = publishedResult.value;
        setProducts(doc.products);
        setFileMeta((prev) => ({
          ...prev,
          published: { schemaVersion: doc.schemaVersion, meta: doc.meta, etag: doc.etag },
        }));
        if (doc.products.length > 0) {
          setSelectedSlug(doc.products[0].slug);
          setLoadState("ready");
          setStatusMessage(`Loaded ${doc.products.length} published records from disk.`);
        } else {
          setLoadState("unavailable");
          setStatusMessage("The published snapshot contains no products.");
        }
      } else {
        setLoadState("unavailable");
        setStatusMessage(
          "Could not load published-tables.json from the local write API. This page only works in local development."
        );
      }

      if (addedResult.status === "fulfilled") {
        const doc = addedResult.value;
        setAddedProducts(doc.products);
        setFileMeta((prev) => ({
          ...prev,
          added: { schemaVersion: doc.schemaVersion, meta: doc.meta, etag: doc.etag },
        }));
      }
      // A rejected added fetch leaves addedProducts/fileMeta.added at their
      // empty defaults -- expected until added-tables.json exists.

      if (candidateResult.status === "fulfilled") {
        const doc = candidateResult.value;
        setCandidateProducts(doc.products);
        setFileMeta((prev) => ({
          ...prev,
          candidate: { schemaVersion: doc.schemaVersion, meta: doc.meta, etag: doc.etag },
        }));
      }
      // Same as added: expected to stay empty until candidate-tables.json exists.
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Whichever array activeTab currently points at. Both the preview
  // selection and the save button read this -- see the file header.
  const activeProducts = useMemo(() => {
    switch (activeTab) {
      case "published":
        return products;
      case "added":
        return addedProducts;
      case "candidate":
        return candidateProducts;
    }
  }, [activeTab, products, addedProducts, candidateProducts]);

  const selected = useMemo(
    () => activeProducts.find((p) => p.slug === selectedSlug) ?? null,
    [activeProducts, selectedSlug]
  );

  const listing = useMemo(() => (selected ? toListingData(selected) : null), [selected]);

  // Switching tabs resets the selection to that tab's own first record (or
  // none, if it's empty) rather than carrying over a slug that belongs to a
  // different array. Reset inline in the click handler (the actual point of
  // change), passed down as EditorSidebar's onActiveTabChange.
  const handleActiveTabChange = useCallback(
    (tab: SourceTab) => {
      setActiveTab(tab);
      const nextArray = tab === "published" ? products : tab === "added" ? addedProducts : candidateProducts;
      setSelectedSlug(nextArray[0]?.slug ?? "");
    },
    [products, addedProducts, candidateProducts]
  );

  // Routes a functional setState update to whichever top-level array
  // activeTab currently points at, so the five field editors below update
  // the array the selected record actually lives in rather than always
  // writing into the published array.
  const setActiveProducts = useCallback(
    (updater: (prev: PublishedProductRecord[]) => PublishedProductRecord[]) => {
      if (activeTab === "published") setProducts(updater);
      else if (activeTab === "added") setAddedProducts(updater);
      else setCandidateProducts(updater);
    },
    [activeTab]
  );

  // Local-state-only update. Does NOT close the dialog itself -- the
  // dialog's own dialog.close() call (in PublishedHeaderEditor.handleSave)
  // is the single path that fires the native "close" event and unmounts it
  // via onClose, matching the pattern already fixed in RawJsonEditor.tsx.
  const handleHeaderSave = useCallback(
    (fields: HeaderFields) => {
      setActiveProducts((prev) => prev.map((p) => (p.slug === selectedSlug ? { ...p, ...fields } : p)));
      setStatusMessage(`Updated header for ${fields.product_name} (not yet saved to disk).`);
    },
    [selectedSlug, setActiveProducts]
  );

  const handleHeaderEditorClosed = useCallback(() => {
    setIsHeaderEditorOpen(false);
    editHeaderButtonRef.current?.focus();
  }, []);

  // Same local-state-only pattern as handleHeaderSave.
  const handleVendorResourcesSave = useCallback(
    (resources: PublishedResourceLink[]) => {
      setActiveProducts((prev) =>
        prev.map((p) => (p.slug === selectedSlug ? { ...p, vendor_resources: resources } : p))
      );
      setStatusMessage(
        `Updated vendor resources (${resources.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [selectedSlug, selected?.product_name, setActiveProducts]
  );

  const handleVendorResourcesEditorClosed = useCallback(() => {
    setIsVendorResourcesEditorOpen(false);
    editVendorResourcesButtonRef.current?.focus();
  }, []);

  // Same local-state-only pattern as handleVendorResourcesSave.
  const handleOtherResourcesSave = useCallback(
    (resources: PublishedResourceLink[]) => {
      setActiveProducts((prev) =>
        prev.map((p) => (p.slug === selectedSlug ? { ...p, other_resources: resources } : p))
      );
      setStatusMessage(
        `Updated other resources (${resources.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [selectedSlug, selected?.product_name, setActiveProducts]
  );

  const handleOtherResourcesEditorClosed = useCallback(() => {
    setIsOtherResourcesEditorOpen(false);
    editOtherResourcesButtonRef.current?.focus();
  }, []);

  // Same local-state-only pattern as handleOtherResourcesSave.
  const handleSupportSave = useCallback(
    (contacts: PublishedSupportContact[]) => {
      setActiveProducts((prev) =>
        prev.map((p) => (p.slug === selectedSlug ? { ...p, support_contacts: contacts } : p))
      );
      setStatusMessage(
        `Updated support contacts (${contacts.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [selectedSlug, selected?.product_name, setActiveProducts]
  );

  const handleSupportEditorClosed = useCallback(() => {
    setIsSupportEditorOpen(false);
    editSupportButtonRef.current?.focus();
  }, []);

  // Same local-state-only pattern as handleSupportSave.
  const handleAcrSave = useCallback(
    (reports: PublishedAcrReport[]) => {
      setActiveProducts((prev) =>
        prev.map((p) => (p.slug === selectedSlug ? { ...p, acr_reports: reports } : p))
      );
      setStatusMessage(
        `Updated ACR reports (${reports.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [selectedSlug, selected?.product_name, setActiveProducts]
  );

  const handleAcrEditorClosed = useCallback(() => {
    setIsAcrEditorOpen(false);
    editAcrButtonRef.current?.focus();
  }, []);

  // Persists the ACTIVE TAB's in-memory draft to disk via that tab's local
  // write API endpoint. Mirrors PublishedJsonWorkbench.tsx's
  // handleSaveToServer: POST the whole document with If-Match, handle
  // 412/400/network distinctly, and update that tab's ETag on success
  // rather than assuming the write landed.
  const handleSaveToServer = useCallback(() => {
    const currentMeta = fileMeta[activeTab];

    if (!currentMeta.etag) {
      setSaveError(
        `Cannot save: no ETag from the server for the ${activeTab} list. The local write API may be unavailable, or ${activeTab}-tables.json does not exist yet (this feature only works in local development).`
      );
      return;
    }
    if (currentMeta.schemaVersion === null || currentMeta.meta === null) {
      setSaveError(`Cannot save: ${activeTab} snapshot metadata was not loaded.`);
      return;
    }

    setSaveError("");
    setStatusMessage("Saving…");

    // $meta describes the SCRAPE, not any one edit -- carried through
    // unchanged from the mount-time fetch rather than reconstructed here.
    const file = { $schema_version: currentMeta.schemaVersion, $meta: currentMeta.meta, products: activeProducts };
    const url = ENDPOINT_FOR_TAB[activeTab];
    const ifMatch = currentMeta.etag;

    startSaveTransition(async () => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": ifMatch },
          body: JSON.stringify(file),
        });

        if (res.status === 412) {
          setStatusMessage("");
          setSaveError(
            "Save failed: the file on disk changed since this copy was loaded. Reload the page and re-apply your edits."
          );
          return;
        }

        if (res.status === 400) {
          const errorBody = await res.json().catch(() => null);
          setStatusMessage("");
          setSaveError(`Save failed: ${errorBody?.error ?? "the server rejected this data."}`);
          return;
        }

        if (!res.ok) {
          setStatusMessage("");
          setSaveError(`Save failed: unexpected server response (${res.status}).`);
          return;
        }

        const result = (await res.json()) as { etag?: string };
        const newEtag = res.headers.get("ETag") ?? result.etag ?? null;
        setFileMeta((prev) => ({ ...prev, [activeTab]: { ...prev[activeTab], etag: newEtag } }));
        setSaveError("");
        setStatusMessage(`Saved ${activeProducts.length} ${activeTab} records to disk.`);
      } catch {
        setStatusMessage("");
        setSaveError("Save failed: could not reach the local write API.");
      }
    });
  }, [activeTab, fileMeta, activeProducts]);

  return (
    <div className="flex min-h-full">
      <EditorSidebar
        publishedProducts={products}
        addedProducts={addedProducts}
        candidateProducts={candidateProducts}
        activeTab={activeTab}
        onActiveTabChange={handleActiveTabChange}
        selectedSlug={selectedSlug}
        onSelectSlug={setSelectedSlug}
      />

      <div className="flex min-w-[1200px] flex-1 flex-col gap-6 p-6">
        <h1 className="text-2xl font-bold text-gray-900 capitalize">{activeTab} Products Editor</h1>

        {/* Polite region: load status, per-section edit confirmations,
            "Saving…" / "Saved" -- rendered unconditionally so it exists in
            the DOM before it is populated. */}
        <p role="status" aria-live="polite" className="text-sm text-gray-600">
          {statusMessage}
        </p>

        {/* Separate assertive region for save failures (412 / 400 / network),
            so a save error interrupts rather than waiting behind polite
            announcements. Also rendered unconditionally, populated later. */}
        <p role="alert" className="text-sm font-semibold text-red-700">
          {saveError}
        </p>

        <div className="flex items-center justify-between pb-4">
          <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0 m-0">
            <legend className="text-sm font-bold text-gray-500">EDIT:</legend>

            <button
              type="button"
              ref={editHeaderButtonRef}
              onClick={() => setIsHeaderEditorOpen(true)}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Header
            </button>

            <button
              type="button"
              ref={editVendorResourcesButtonRef}
              onClick={() => setIsVendorResourcesEditorOpen(true)}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Vendor Resources
            </button>

            <button
              type="button"
              ref={editOtherResourcesButtonRef}
              onClick={() => setIsOtherResourcesEditorOpen(true)}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Other Resources
            </button>

            <button
              type="button"
              ref={editSupportButtonRef}
              onClick={() => setIsSupportEditorOpen(true)}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Support
            </button>

            <button
              type="button"
              ref={editAcrButtonRef}
              onClick={() => setIsAcrEditorOpen(true)}
              disabled={!selected}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              ACR
            </button>
          </fieldset>

          <button
            type="button"
            onClick={handleSaveToServer}
            disabled={isSaving}
            className="rounded border border-transparent bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            {isSaving ? "Saving…" : `Save ${activeTab}`}
          </button>
        </div>

        <section aria-label="Visual preview" className="rounded border border-gray-200 bg-gray-50 p-4">
          {loadState === "loading" ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : loadState === "unavailable" ? (
            <p className="text-sm text-gray-500">No preview available.</p>
          ) : listing ? (
            <ListingCard listing={listing} />
          ) : (
            <p className="text-sm text-gray-500">Select a product to preview it.</p>
          )}
        </section>

        {isHeaderEditorOpen && selected ? (
          // key forces a fresh mount per record, so a future refactor that
          // keeps the editor mounted across a selection change cannot
          // silently leak one record's draft into another.
          <PublishedHeaderEditor
            key={selected.slug}
            record={selected}
            onSave={handleHeaderSave}
            onClose={handleHeaderEditorClosed}
          />
        ) : null}

        {isVendorResourcesEditorOpen && selected ? (
          <PublishedVendorResourcesEditor
            key={selected.slug}
            record={selected}
            onSave={handleVendorResourcesSave}
            onClose={handleVendorResourcesEditorClosed}
          />
        ) : null}

        {isOtherResourcesEditorOpen && selected ? (
          <PublishedOtherResourcesEditor
            key={selected.slug}
            record={selected}
            onSave={handleOtherResourcesSave}
            onClose={handleOtherResourcesEditorClosed}
          />
        ) : null}

        {isSupportEditorOpen && selected ? (
          <PublishedSupportEditor
            key={selected.slug}
            record={selected}
            onSave={handleSupportSave}
            onClose={handleSupportEditorClosed}
          />
        ) : null}

        {isAcrEditorOpen && selected ? (
          <PublishedAcrEditor
            key={selected.slug}
            record={selected}
            onSave={handleAcrSave}
            onClose={handleAcrEditorClosed}
          />
        ) : null}
      </div>
    </div>
  );
}
