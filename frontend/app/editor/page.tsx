// frontend/app/editor/page.tsx
"use client";

/**
 * Visual editor for published.json -- a lightweight parallel to the
 * legacy AppSheet-candidate main page (app/page.tsx), scoped to editing the
 * live published-site snapshot instead. Deliberately NOT a duplicate of
 * that 1000+ line page or its AppSheet-specific pieces: no ResearcherTable,
 * no ImportDataModal, no AppSheet fetching.
 *
 * Data comes from the same local-only write API the /tables/published JSON
 * editor uses (see lib/local-write.ts and docs/NERD_System_Architecture.md),
 * fetched client-side on mount -- this page has no Server Component data
 * loader, so "fresh from disk" is the only read path, not a fallback.
 *
 * Three documents, one page: published.json, added.json, and
 * candidate.json are fetched concurrently on mount via
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
 * Candidate-only controls -- "Import Candidate" (inside the EDIT: fieldset,
 * separated with a small left margin since it isn't an edit action like its
 * siblings), "Add to Site" (still stubbed with alert("Stubbed")), and
 * "Delete Candidate" -- only render while activeTab === "candidate".
 * handleImport reuses setActiveProducts (safe here because the import
 * dialog is modal -- the sidebar's tab buttons are inert while it's open,
 * so activeTab cannot change out from under the import) and guards against
 * a slug collision before adding.
 *
 * "Delete Candidate" opens DeleteCandidateModal for confirmation; on
 * confirm, handleDeleteConfirm filters the selected record out of
 * activeProducts and calls handleSaveToServer(newArray) with that filtered
 * array PASSED DIRECTLY, not left to be read from state. This matters:
 * setActiveProducts's update is async (React batches/schedules state
 * updates), so if handleSaveToServer read activeProducts from its own
 * closure instead, it could POST the pre-delete array and briefly resurrect
 * the "deleted" record in candidate.json on the next save. Passing
 * newArray explicitly is what makes the disk write and the UI update
 * consistent in the same tick. handleSaveToServer therefore accepts an
 * optional recordsToSave override, falling back to activeProducts when
 * omitted (the normal "Save {activeTab}" button path).
 *
 * Added-only controls -- "Published" (still stubbed with alert("Stubbed"),
 * flanking Save on the left) and "Delete added" (flanking Save on the
 * right, opens DeleteAddedModal) -- only render while activeTab === "added",
 * mirroring Candidate's "Added to Site"/"Delete Candidate" pair one tab up
 * the lifecycle. handleDeleteAddedConfirm is handleDeleteConfirm's exact
 * structure against addedProducts instead of candidateProducts -- kept as a
 * separate function, not a parameterized one, because a shared helper would
 * need to take the modal-close ref, the array, and the setter as
 * parameters for a two-line body, which reads worse than the duplication.
 *
 * The TRACKING: fieldset (Priority/Status/Gatherer/Reviewer) lives in the
 * page <header>, to the right of the <h1>/status message, not in the main
 * control bar -- it's metadata about the record, not an action, so it reads
 * better grouped with the page title than with the EDIT:/Save controls.
 * Each dropdown is a controlled input bound directly to the selected
 * record's tracking_* field (selected?.tracking_priority ?? "", etc.) and
 * writes through setActiveProducts on change -- the same local-state-only
 * pattern as the five field editors' save handlers, just without a modal in
 * front of it. An empty selection is stored as null, not "", so a cleared
 * dropdown round-trips the same way the rest of the schema's nullable
 * string fields do (see published-validate.ts's NULLABLE_STRING_FIELDS).
 * Gatherer/Reviewer options come from lib/users.ts's USERS list, filtered
 * to role === "Researcher" -- the same source and role check the legacy
 * /users page uses.
 *
 * Two-column layout, sized for a wide desktop window rather than
 * responsively: EditorSidebar is a fixed-width, self-sticking left column
 * (product source tabs, filter, and the scrollable list itself -- replaces
 * the old top-bar <select>); the right-hand content column carries a hard
 * min-w-[1200px] so the preview never squishes on a narrower viewport. The
 * outer wrapper has no max-width, so the page can grow past 1200px+320px
 * freely rather than being centered in a fixed band.
 *
 * "Save" persists the ACTIVE TAB's in-memory array: POST the whole document
 * ({ $schema_version, $meta, products }) to that tab's /api/local/*
 * endpoint with its own current ETag in If-Match, wrapped in useTransition
 * (see docs/superseded/legacy_published_json_workbench.tsx for the original
 * raw-JSON editor this pattern was adapted from).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ListingCard } from "@/components/ListingCard";
import { EditorSidebar, type SourceTab } from "@/components/EditorSidebar";
import { PublishedHeaderEditor, type HeaderFields } from "@/components/PublishedHeaderEditor";
import { PublishedVendorResourcesEditor } from "@/components/PublishedVendorResourcesEditor";
import { PublishedOtherResourcesEditor } from "@/components/PublishedOtherResourcesEditor";
import { PublishedSupportEditor } from "@/components/PublishedSupportEditor";
import { PublishedAcrEditor } from "@/components/PublishedAcrEditor";
import { ImportJsonModal } from "@/components/ImportJsonModal";
import { DeleteCandidateModal } from "@/components/DeleteCandidateModal";
import { DeleteAddedModal } from "@/components/DeleteAddedModal";
import { DeletePublishedModal } from "@/components/DeletePublishedModal";
import { toListingData } from "@/lib/editor-preview";
import { USERS, fullName } from "@/lib/users";
import vendorsData from "@/lib/vendors.json";
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

interface SnapshotMeta {
  purpose: string;
  source_listing_url: string;
  snapshot_taken_at: string;
  total_products: number;
  generated_from: string;
}

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

// Same source and role check as frontend/app/users/page.tsx. Computed once
// at module load -- USERS is a static, hardcoded array (see lib/users.ts),
// not something that changes at runtime, so there's nothing to re-derive
// per render or refetch on mount.
const RESEARCHER_NAMES = USERS.filter((u) => u.role === "Researcher").map(fullName);

/** One entry from frontend/lib/vendors.json's `vendors` array -- only the
 *  fields this page actually reads (see vendor_schema_proposal.ts for the
 *  full VendorRecord/VendorResource shape). */
interface VendorRegistryEntry {
  vendor_name: string;
  resources: PublishedResourceLink[];
}

// vendorsData is a static JSON import, same as USERS above -- always
// synchronously available at module load, so it's a plain derived constant
// rather than state populated from an effect (which is what tripped the
// "Calling setState synchronously within an effect" rule this codebase has
// hit before -- see the effect below's own header comment on that rule).
// vendors.json's entries aren't uniform -- some are minimal stub records
// with no `resources` field at all -- so the raw import doesn't structurally
// satisfy VendorRegistryEntry. Asserted rather than reshaped: this page is
// deleted wholesale in Phase 6, and the only consumer (globalVendor lookup
// below) already guards with `globalVendor?.resources || []`.
const VENDORS_REGISTRY: VendorRegistryEntry[] = vendorsData.vendors as unknown as VendorRegistryEntry[];

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
  const [activeTab, setActiveTab] = useState<SourceTab>("candidate");

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
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleteAddedModalOpen, setIsDeleteAddedModalOpen] = useState(false);
  const [isDeletePublishedModalOpen, setIsDeletePublishedModalOpen] = useState(false);

  const editHeaderButtonRef = useRef<HTMLButtonElement>(null);
  const editVendorResourcesButtonRef = useRef<HTMLButtonElement>(null);
  const editOtherResourcesButtonRef = useRef<HTMLButtonElement>(null);
  const editSupportButtonRef = useRef<HTMLButtonElement>(null);
  const editAcrButtonRef = useRef<HTMLButtonElement>(null);
  const importCandidateButtonRef = useRef<HTMLButtonElement>(null);
  const deleteCandidateButtonRef = useRef<HTMLButtonElement>(null);
  const deleteAddedButtonRef = useRef<HTMLButtonElement>(null);
  const deletePublishedButtonRef = useRef<HTMLButtonElement>(null);

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
        setLoadState(doc.products.length > 0 ? "ready" : "unavailable");
      } else {
        setLoadState("unavailable");
        setSaveError(
          "Could not load published.json from the local write API. This page only works in local development."
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
      // empty defaults -- expected until added.json exists.

      if (candidateResult.status === "fulfilled") {
        const doc = candidateResult.value;
        setCandidateProducts(doc.products);
        setFileMeta((prev) => ({
          ...prev,
          candidate: { schemaVersion: doc.schemaVersion, meta: doc.meta, etag: doc.etag },
        }));
      }
      // Same as added: expected to stay empty until candidate.json exists.

      // Candidate is the default tab (see activeTab's initial state above),
      // so the initial selection prefers the candidate list's first record.
      // Falls back to published's first record when candidate is empty
      // (still expected today, since candidate.json is new) rather
      // than leaving the preview with nothing selected.
      const candidateDoc = candidateResult.status === "fulfilled" ? candidateResult.value : null;
      const publishedDoc = publishedResult.status === "fulfilled" ? publishedResult.value : null;
      if (candidateDoc && candidateDoc.products.length > 0) {
        setSelectedSlug(candidateDoc.products[0].slug);
      } else if (publishedDoc && publishedDoc.products.length > 0) {
        setSelectedSlug(publishedDoc.products[0].slug);
      }

      // activeTab's own initial state is "candidate" (see above), so the
      // very first status message reflects the candidate list's count.
      setStatusMessage(`Displaying ${candidateDoc?.products.length ?? 0} candidate product records.`);
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

  // Enriches the PREVIEW ONLY -- selected/activeProducts (what gets edited
  // and saved) never include the global vendor's resources, only the
  // product's own. globalVendor is looked up by exact vendor_name match,
  // matching the same join convention vendors.json's own header documents
  // (see vendor_schema_proposal.ts). Ordering is load-bearing: product-
  // specific resources must render before the vendor's global resources to
  // match the live NCADEMI site's own "From {vendor}" list.
  const listing = useMemo(() => {
    if (!selected) return null;
    const globalVendor = VENDORS_REGISTRY.find((v) => v.vendor_name === selected.vendor_name);
    const previewRecord = {
      ...selected,
      vendor_resources: [...(selected.vendor_resources || []), ...(globalVendor?.resources || [])],
    };
    return toListingData(previewRecord);
  }, [selected]);

  // Switching tabs resets the selection to that tab's own first record (or
  // none, if it's empty) rather than carrying over a slug that belongs to a
  // different array. Reset inline in the click handler (the actual point of
  // change), passed down as EditorSidebar's onActiveTabChange.
  const handleActiveTabChange = useCallback(
    (tab: SourceTab) => {
      setActiveTab(tab);
      const nextArray = tab === "published" ? products : tab === "added" ? addedProducts : candidateProducts;
      setSelectedSlug(nextArray[0]?.slug ?? "");
      setStatusMessage(`Displaying ${nextArray.length} ${tab} product records.`);
    },
    [products, addedProducts, candidateProducts]
  );

  // Routes a functional setState update to whichever top-level array
  // activeTab currently points at, so the five field editors below (and
  // handleImport/handleDeleteConfirm) update the array the selected record
  // actually lives in rather than always writing into the published array.
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

  // Adds an imported record into the active list (Candidate only -- see the
  // "Import Candidate" button below), after checking for a slug collision,
  // then re-sorts the whole list alphabetically by product_name -- matching
  // EditorSidebar's own default A-Z sort, so the sidebar doesn't briefly
  // show an unsorted list before its own sort re-applies on next render.
  // Reads/writes setActiveProducts directly rather than a
  // functional prev-based dedupe check because the modal is native-modal
  // (background inert), so activeTab/activeProducts cannot change out from
  // under this between the button click that opened it and this callback.
  const handleImport = useCallback(
    (record: PublishedProductRecord) => {
      if (activeProducts.some((p) => p.slug === record.slug)) {
        setStatusMessage(
          `Cannot import: slug "${record.slug}" already exists in the ${activeTab} list.`
        );
        return;
      }
      setActiveProducts((prev) =>
        [...prev, record].sort((a, b) => a.product_name.localeCompare(b.product_name))
      );
      setSelectedSlug(record.slug);
      setStatusMessage(
        `Imported "${record.product_name}" into the ${activeTab} list (not yet saved to disk).`
      );
    },
    [activeProducts, activeTab, setActiveProducts]
  );

  const handleImportModalClosed = useCallback(() => {
    setIsImportModalOpen(false);
    importCandidateButtonRef.current?.focus();
  }, []);

  const handleDeleteModalClosed = useCallback(() => {
    setIsDeleteModalOpen(false);
    deleteCandidateButtonRef.current?.focus();
  }, []);

  const handleDeleteAddedModalClosed = useCallback(() => {
    setIsDeleteAddedModalOpen(false);
    deleteAddedButtonRef.current?.focus();
  }, []);

  const handleDeletePublishedModalClosed = useCallback(() => {
    setIsDeletePublishedModalOpen(false);
    deletePublishedButtonRef.current?.focus();
  }, []);

  // Core save logic for a SINGLE tab, factored out of handleSaveToServer so
  // handlePromoteRecord below can await two of these in sequence (dest write,
  // then source write) without nesting one startSaveTransition inside
  // another. Deliberately NOT wrapped in startSaveTransition itself -- that
  // stays the caller's responsibility, since a caller may need to run
  // several of these before deciding what to tell the user.
  const saveTabToServer = useCallback(
    async (tab: SourceTab, records: PublishedProductRecord[]): Promise<boolean> => {
      const currentMeta = fileMeta[tab];

      if (!currentMeta.etag) {
        setStatusMessage("");
        setSaveError(
          `Cannot save: no ETag from the server for the ${tab} list. The local write API may be unavailable, or ${tab}.json does not exist yet (this feature only works in local development).`
        );
        return false;
      }
      if (currentMeta.schemaVersion === null || currentMeta.meta === null) {
        setStatusMessage("");
        setSaveError(`Cannot save: ${tab} snapshot metadata was not loaded.`);
        return false;
      }

      // $meta describes the SCRAPE, not any one edit -- carried through
      // unchanged from the mount-time fetch rather than reconstructed here.
      const file = {
        $schema_version: currentMeta.schemaVersion,
        $meta: currentMeta.meta,
        products: records,
      };
      const url = ENDPOINT_FOR_TAB[tab];
      const ifMatch = currentMeta.etag;

      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": ifMatch },
          body: JSON.stringify(file),
        });

        if (res.status === 412) {
          setStatusMessage("");
          setSaveError(
            "Save failed because the data was changed on a different tab or by another user. Reload the page and re-apply your edits."
          );
          return false;
        }

        if (res.status === 400) {
          const errorBody = await res.json().catch(() => null);
          setStatusMessage("");
          setSaveError(`Save failed: ${errorBody?.error ?? "the server rejected this data."}`);
          return false;
        }

        if (!res.ok) {
          setStatusMessage("");
          setSaveError(`Save failed: unexpected server response (${res.status}).`);
          return false;
        }

        const result = (await res.json()) as { etag?: string };
        const newEtag = res.headers.get("ETag") ?? result.etag ?? null;
        setFileMeta((prev) => ({ ...prev, [tab]: { ...prev[tab], etag: newEtag } }));
        setSaveError("");
        return true;
      } catch {
        setStatusMessage("");
        setSaveError("Save failed: could not reach the local write API.");
        return false;
      }
    },
    [fileMeta]
  );

  // Persists the ACTIVE TAB's in-memory draft to disk via that tab's local
  // write API endpoint. Thin wrapper around saveTabToServer: sets the
  // "Saving…" status before the request and the "Saved N records" status
  // after, leaving all the actual request/error handling to the shared
  // helper. recordsToSave lets a caller (handleDeleteConfirm,
  // handleDeleteAddedConfirm) pass a freshly computed array directly
  // instead of relying on activeProducts, which would still reflect the
  // pre-delete state until React's async update lands -- see the file
  // header.
  const handleSaveToServer = useCallback(
    (recordsToSave?: PublishedProductRecord[]) => {
      const productsToSave = recordsToSave ?? activeProducts;
      setSaveError("");
      setStatusMessage("Saving…");
      startSaveTransition(async () => {
        const success = await saveTabToServer(activeTab, productsToSave);
        if (success) {
          setStatusMessage(`Saved ${productsToSave.length} ${activeTab} records to disk.`);
        }
      });
    },
    [activeTab, activeProducts, saveTabToServer]
  );

  // Moves the selected record from the active tab to destTab (Candidate ->
  // Added via "Added to Site", Added -> Published via "Published"),
  // stripping the TRACKING: fieldset's metadata on the way -- that metadata
  // belongs to the pre-publish workflow the record is leaving, and the
  // fieldset itself stops rendering those fields once a record reaches its
  // destination tab (see the TRACKING: fieldset's conditional rendering
  // above), so a stale value would be invisible in the UI but still sitting
  // in the file.
  //
  // Writes the destination file BEFORE the source file, and only removes
  // the record from the source tab's in-memory/on-disk state if the
  // destination write actually succeeded -- a failed destination write
  // (e.g. a 412 from a stale ETag) leaves the record exactly where it
  // started rather than deleting the only copy of it.
  const handlePromoteRecord = useCallback(
    (destTab: "added" | "published") => {
      if (!selected) return;

      const promotedRecord = { ...selected };
      delete promotedRecord.tracking_priority;
      delete promotedRecord.tracking_status;
      delete promotedRecord.tracking_gatherer;
      delete promotedRecord.tracking_reviewer;

      const newSourceArray = activeProducts.filter((p) => p.slug !== selected.slug);
      const newDestArray = [promotedRecord, ...(destTab === "added" ? addedProducts : products)];

      startSaveTransition(async () => {
        const destSuccess = await saveTabToServer(destTab, newDestArray);
        if (!destSuccess) return;

        const sourceSuccess = await saveTabToServer(activeTab, newSourceArray);
        if (!sourceSuccess) return;

        if (destTab === "added") setAddedProducts(newDestArray);
        else setProducts(newDestArray);
        setActiveProducts(() => newSourceArray);
        setSelectedSlug(newSourceArray[0]?.slug ?? "");
        setStatusMessage(`Successfully moved to ${destTab}.`);
      });
    },
    [selected, activeProducts, activeTab, addedProducts, products, saveTabToServer, setActiveProducts]
  );

  // Permanently removes the selected Candidate record: updates the
  // in-memory list, resets the selection, and immediately saves the
  // filtered array to candidate.json -- see the file header for why
  // newArray is passed to handleSaveToServer directly rather than left for
  // it to read from (still-stale) activeProducts.
  const handleDeleteConfirm = useCallback(() => {
    if (!selected) return;
    const newArray = activeProducts.filter((p) => p.slug !== selected.slug);
    setActiveProducts(() => newArray);
    setSelectedSlug(newArray[0]?.slug ?? "");
    handleSaveToServer(newArray);
  }, [selected, activeProducts, setActiveProducts, handleSaveToServer]);

  // Permanently removes the selected Added record. Same structure as
  // handleDeleteConfirm -- see the file header for why this is a separate
  // function rather than a shared parameterized one.
  const handleDeleteAddedConfirm = useCallback(() => {
    if (!selected) return;
    const newArray = activeProducts.filter((p) => p.slug !== selected.slug);
    setActiveProducts(() => newArray);
    setSelectedSlug(newArray[0]?.slug ?? "");
    handleSaveToServer(newArray);
  }, [selected, activeProducts, setActiveProducts, handleSaveToServer]);

  // Permanently removes the selected Published record. Same structure as
  // handleDeleteAddedConfirm, but filters/sets `products` directly rather
  // than going through activeProducts/setActiveProducts -- this button only
  // renders on the Published tab, so the two are equivalent here, but
  // `products` makes the target explicit rather than implicit in activeTab.
  const handleDeletePublishedConfirm = useCallback(() => {
    if (!selected) return;
    const newArray = products.filter((p) => p.slug !== selected.slug);
    setProducts(newArray);
    setSelectedSlug(newArray[0]?.slug ?? "");
    handleSaveToServer(newArray);
  }, [selected, products, handleSaveToServer]);

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
        <header className="flex items-end justify-between">
          <div className="flex flex-row items-center gap-4">
            <h1 className="text-2xl font-bold text-gray-900 capitalize whitespace-nowrap shrink-0">
              {activeTab} Products Editor
            </h1>
          </div>
        </header>

        <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
          <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Tracking</div>

            <div className="flex flex-wrap items-center gap-3 p-4">
            <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Priority
              <select
                value={selected?.tracking_priority ?? ""}
                onChange={(e) =>
                  setActiveProducts((prev) =>
                    prev.map((p) =>
                      p.slug === selectedSlug ? { ...p, tracking_priority: e.target.value || null } : p
                    )
                  )
                }
                disabled={!selected}
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">set priority</option>
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </label>

            {/* Status only makes sense while a record is still moving through
                a workflow -- candidate (intake) and added (vendor contact) --
                published records are already past that, so only Priority
                (which still applies as a general triage signal) shows there.
                The option list itself is tab-specific: candidate's options
                describe intake progress, added's describe vendor contact
                progress -- the two lists don't share any values. */}
            {activeTab === "candidate" || activeTab === "added" ? (
              <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Status
                <select
                  value={selected?.tracking_status ?? ""}
                  onChange={(e) =>
                    setActiveProducts((prev) =>
                      prev.map((p) =>
                        p.slug === selectedSlug ? { ...p, tracking_status: e.target.value || null } : p
                      )
                    )
                  }
                  disabled={!selected}
                  className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">set status</option>
                  {activeTab === "candidate" ? (
                    <>
                      <option value="Gathering">Gathering</option>
                      <option value="Needs Review">Needs Review</option>
                      <option value="Discussion">Discussion</option>
                      <option value="Ready for Site">Ready for Site</option>
                    </>
                  ) : (
                    <>
                      <option value="contacted vendor">contacted vendor</option>
                      <option value="replied back to vendor">replied back to vendor</option>
                    </>
                  )}
                </select>
              </label>
            ) : null}

            {/* Gatherer/Reviewer stay candidate-only -- they track who's
                doing the intake research itself, which added/published
                records are already past. */}
            {activeTab === "candidate" ? (
              <>
                <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Gatherer
                  <select
                    value={selected?.tracking_gatherer ?? ""}
                    onChange={(e) =>
                      setActiveProducts((prev) =>
                        prev.map((p) =>
                          p.slug === selectedSlug ? { ...p, tracking_gatherer: e.target.value || null } : p
                        )
                      )
                    }
                    disabled={!selected}
                    className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">set gatherer</option>
                    {RESEARCHER_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Reviewer
                  <select
                    value={selected?.tracking_reviewer ?? ""}
                    onChange={(e) =>
                      setActiveProducts((prev) =>
                        prev.map((p) =>
                          p.slug === selectedSlug ? { ...p, tracking_reviewer: e.target.value || null } : p
                        )
                      )
                    }
                    disabled={!selected}
                    className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <option value="">set reviewer</option>
                    {RESEARCHER_NAMES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
            </div>
        </div>

        <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
          <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Edit</div>

              <div className="flex flex-wrap items-center gap-3 p-4">
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

              {activeTab === "candidate" ? (
                <button
                  type="button"
                  ref={importCandidateButtonRef}
                  onClick={() => setIsImportModalOpen(true)}
                  className="ml-3.5 rounded border border-transparent bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  Import Candidate
                </button>
              ) : null}
              </div>
        </div>

        <section aria-label="Visual preview" className="rounded border border-gray-200 bg-gray-50 p-4">
          <div className="flex justify-end gap-3 pb-[10px]">
            {activeTab === "candidate" ? (
              <button
                type="button"
                onClick={() => handlePromoteRecord("added")}
                disabled={!selected}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Added to Site
              </button>
            ) : null}

            {activeTab === "added" ? (
              <button
                type="button"
                onClick={() => handlePromoteRecord("published")}
                disabled={!selected}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Published
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => handleSaveToServer()}
              disabled={isSaving}
              className="rounded border border-transparent bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {isSaving ? "Saving…" : `Save ${activeTab}`}
            </button>

            {activeTab === "added" ? (
              <button
                type="button"
                ref={deleteAddedButtonRef}
                onClick={() => setIsDeleteAddedModalOpen(true)}
                disabled={!selected}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Delete added
              </button>
            ) : null}

            {activeTab === "published" ? (
              <button
                type="button"
                ref={deletePublishedButtonRef}
                onClick={() => setIsDeletePublishedModalOpen(true)}
                disabled={!selected}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Delete published
              </button>
            ) : null}

            {activeTab === "candidate" ? (
              <button
                type="button"
                ref={deleteCandidateButtonRef}
                onClick={() => setIsDeleteModalOpen(true)}
                disabled={!selected}
                className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                Delete Candidate
              </button>
            ) : null}
          </div>

          {loadState === "loading" ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : loadState === "unavailable" ? (
            <p className="text-sm text-gray-500">No preview available.</p>
          ) : listing ? (
            <div className="w-full bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
              <ListingCard listing={listing} />
            </div>
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

        {isImportModalOpen ? (
          <ImportJsonModal onImport={handleImport} onClose={handleImportModalClosed} />
        ) : null}

        {isDeleteModalOpen ? (
          <DeleteCandidateModal onConfirm={handleDeleteConfirm} onClose={handleDeleteModalClosed} />
        ) : null}

        {isDeleteAddedModalOpen ? (
          <DeleteAddedModal onConfirm={handleDeleteAddedConfirm} onClose={handleDeleteAddedModalClosed} />
        ) : null}

        {isDeletePublishedModalOpen ? (
          <DeletePublishedModal
            onConfirm={handleDeletePublishedConfirm}
            onClose={handleDeletePublishedModalClosed}
          />
        ) : null}

        <footer className="mt-auto pt-6">
          <div className="w-full rounded-md border border-gray-300 bg-white">
            <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">
              Messages
            </div>
            <div className="flex flex-col gap-1 p-4">
              <p role="status" aria-live="polite" className="text-sm text-gray-600 min-h-[1.25rem]">
                {statusMessage}
              </p>
              <p role="alert" className="text-sm font-semibold text-red-700 min-h-[1.25rem]">
                {saveError}
              </p>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
