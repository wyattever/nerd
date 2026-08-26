// frontend/app/editor/(routed)/candidates/CandidateEditor.tsx
"use client";

/**
 * Candidate tab's selected-record editor -- tracking fieldset, field
 * editors, and save/delete/promote handlers, split out of
 * CandidatesListPanel.tsx now that selection is a real route
 * (candidates/[slug]/page.tsx renders this) instead of local state. See
 * that page's header for why this does its own independent getCandidates()
 * read rather than sharing candidates/layout.tsx's.
 *
 * `slug` is a route param, not settable state -- this component remounts
 * fresh (new local `products`/`etag`/etc. state) on every navigation to a
 * different record, since Next renders a new subtree below the persisting
 * layout for each [slug] match. That's deliberate: it's the same "no
 * leaked draft between records" property the legacy monolith got from
 * `key={selected.slug}` on its field-editor modals, just extended to the
 * whole editor instead of one modal at a time.
 *
 * Delete and promote (`handlePromoteToAdded`) both navigate back to the
 * bare /editor/candidates leaf on success via router.push -- unlike the
 * pre-route version, the record being removed IS the current route, so
 * "deselect" now has to be an actual navigation rather than clearing local
 * state. router.push, not replace: leaving a back-button entry to the
 * (now-gone) record's URL is consistent with Phase 4's decision (documented
 * in the routing guide) not to fight back/forward navigation.
 */

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListingCard } from "@/components/ListingCard";
import { PublishedHeaderEditor, type HeaderFields } from "@/components/PublishedHeaderEditor";
import { PublishedVendorResourcesEditor } from "@/components/PublishedVendorResourcesEditor";
import { PublishedOtherResourcesEditor } from "@/components/PublishedOtherResourcesEditor";
import { PublishedSupportEditor } from "@/components/PublishedSupportEditor";
import { PublishedAcrEditor } from "@/components/PublishedAcrEditor";
import { ImportJsonModal } from "@/components/ImportJsonModal";
import { DeleteCandidateModal } from "@/components/DeleteCandidateModal";
import { toListingData } from "@/lib/editor-preview";
import { USERS, fullName } from "@/lib/users";
import vendorsData from "@/lib/vendors.json";
import { useMessages } from "./CandidatesListPanel";
import type { SnapshotMeta } from "@/lib/local-data";
import type {
  PublishedAcrReport,
  PublishedProductRecord,
  PublishedResourceLink,
  PublishedSupportContact,
} from "@/lib/published-tables";

const RESEARCHER_NAMES = USERS.filter((u) => u.role === "Researcher").map(fullName);

interface VendorRegistryEntry {
  vendor_name: string;
  resources: PublishedResourceLink[];
}
const VENDORS_REGISTRY: VendorRegistryEntry[] = vendorsData.vendors as unknown as VendorRegistryEntry[];

interface CandidateEditorProps {
  slug: string;
  initialProducts: PublishedProductRecord[];
  initialSchemaVersion: number | null;
  initialMeta: SnapshotMeta | null;
  initialEtag: string;
}

async function fetchDocument(url: string): Promise<{
  products: PublishedProductRecord[];
  schemaVersion: number | null;
  meta: SnapshotMeta | null;
  etag: string | null;
}> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}`);
  const etag = res.headers.get("ETag");
  const body = (await res.json()) as { $schema_version?: unknown; $meta?: unknown; products?: unknown };
  return {
    products: Array.isArray(body.products) ? (body.products as PublishedProductRecord[]) : [],
    schemaVersion: typeof body.$schema_version === "number" ? body.$schema_version : null,
    meta: body.$meta ? (body.$meta as SnapshotMeta) : null,
    etag,
  };
}

export function CandidateEditor({
  slug,
  initialProducts,
  initialSchemaVersion,
  initialMeta,
  initialEtag,
}: CandidateEditorProps) {
  const router = useRouter();

  const [products, setProducts] = useState<PublishedProductRecord[]>(initialProducts);
  const [schemaVersion] = useState(initialSchemaVersion);
  const [meta] = useState(initialMeta);
  const [etag, setEtag] = useState<string | null>(initialEtag);

  const { setStatusMessage, setSaveError } = useMessages();
  const [isSaving, startSaveTransition] = useTransition();

  const [isHeaderEditorOpen, setIsHeaderEditorOpen] = useState(false);
  const [isVendorResourcesEditorOpen, setIsVendorResourcesEditorOpen] = useState(false);
  const [isOtherResourcesEditorOpen, setIsOtherResourcesEditorOpen] = useState(false);
  const [isSupportEditorOpen, setIsSupportEditorOpen] = useState(false);
  const [isAcrEditorOpen, setIsAcrEditorOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const editHeaderButtonRef = useRef<HTMLButtonElement>(null);
  const editVendorResourcesButtonRef = useRef<HTMLButtonElement>(null);
  const editOtherResourcesButtonRef = useRef<HTMLButtonElement>(null);
  const editSupportButtonRef = useRef<HTMLButtonElement>(null);
  const editAcrButtonRef = useRef<HTMLButtonElement>(null);
  const importCandidateButtonRef = useRef<HTMLButtonElement>(null);
  const deleteCandidateButtonRef = useRef<HTMLButtonElement>(null);

  const selected = useMemo(() => products.find((p) => p.slug === slug) ?? null, [products, slug]);

  const listing = useMemo(() => {
    if (!selected) return null;
    const globalVendor = VENDORS_REGISTRY.find((v) => v.vendor_name === selected.vendor_name);
    const previewRecord = {
      ...selected,
      vendor_resources: [...(selected.vendor_resources || []), ...(globalVendor?.resources || [])],
    };
    return toListingData(previewRecord);
  }, [selected]);

  const handleHeaderSave = useCallback(
    (fields: HeaderFields) => {
      setProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, ...fields } : p)));
      setStatusMessage(`Updated header for ${fields.product_name} (not yet saved to disk).`);
    },
    [slug, setStatusMessage]
  );
  const handleHeaderEditorClosed = useCallback(() => {
    setIsHeaderEditorOpen(false);
    editHeaderButtonRef.current?.focus();
  }, []);

  const handleVendorResourcesSave = useCallback(
    (resources: PublishedResourceLink[]) => {
      setProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, vendor_resources: resources } : p)));
      setStatusMessage(
        `Updated vendor resources (${resources.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [slug, selected?.product_name, setStatusMessage]
  );
  const handleVendorResourcesEditorClosed = useCallback(() => {
    setIsVendorResourcesEditorOpen(false);
    editVendorResourcesButtonRef.current?.focus();
  }, []);

  const handleOtherResourcesSave = useCallback(
    (resources: PublishedResourceLink[]) => {
      setProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, other_resources: resources } : p)));
      setStatusMessage(
        `Updated other resources (${resources.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [slug, selected?.product_name, setStatusMessage]
  );
  const handleOtherResourcesEditorClosed = useCallback(() => {
    setIsOtherResourcesEditorOpen(false);
    editOtherResourcesButtonRef.current?.focus();
  }, []);

  const handleSupportSave = useCallback(
    (contacts: PublishedSupportContact[]) => {
      setProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, support_contacts: contacts } : p)));
      setStatusMessage(
        `Updated support contacts (${contacts.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [slug, selected?.product_name, setStatusMessage]
  );
  const handleSupportEditorClosed = useCallback(() => {
    setIsSupportEditorOpen(false);
    editSupportButtonRef.current?.focus();
  }, []);

  const handleAcrSave = useCallback(
    (reports: PublishedAcrReport[]) => {
      setProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, acr_reports: reports } : p)));
      setStatusMessage(
        `Updated ACR reports (${reports.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [slug, selected?.product_name, setStatusMessage]
  );
  const handleAcrEditorClosed = useCallback(() => {
    setIsAcrEditorOpen(false);
    editAcrButtonRef.current?.focus();
  }, []);

  const handleImport = useCallback(
    (record: PublishedProductRecord) => {
      if (products.some((p) => p.slug === record.slug)) {
        setStatusMessage(`Cannot import: slug "${record.slug}" already exists in the candidate list.`);
        return;
      }
      setProducts((prev) => [...prev, record].sort((a, b) => a.product_name.localeCompare(b.product_name)));
      setStatusMessage(`Imported "${record.product_name}" into the candidate list (not yet saved to disk).`);
    },
    [products, setStatusMessage]
  );
  const handleImportModalClosed = useCallback(() => {
    setIsImportModalOpen(false);
    importCandidateButtonRef.current?.focus();
  }, []);
  const handleDeleteModalClosed = useCallback(() => {
    setIsDeleteModalOpen(false);
    deleteCandidateButtonRef.current?.focus();
  }, []);

  const postDocument = useCallback(
    async (
      kind: "candidate" | "added",
      records: PublishedProductRecord[],
      version: number,
      docMeta: SnapshotMeta,
      ifMatch: string
    ): Promise<string | null> => {
      const res = await fetch(`/api/local/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "If-Match": ifMatch },
        body: JSON.stringify({ $schema_version: version, $meta: docMeta, products: records }),
      });

      if (res.status === 412) {
        setSaveError("Save failed: the file on disk changed since this copy was loaded. Reload the page and re-apply your edits.");
        return null;
      }
      if (res.status === 400) {
        const errorBody = await res.json().catch(() => null);
        setSaveError(`Save failed: ${errorBody?.error ?? "the server rejected this data."}`);
        return null;
      }
      if (!res.ok) {
        setSaveError(`Save failed: unexpected server response (${res.status}).`);
        return null;
      }
      const result = (await res.json()) as { etag?: string };
      return res.headers.get("ETag") ?? result.etag ?? null;
    },
    [setSaveError]
  );

  const handleSaveToServer = useCallback(
    (recordsToSave?: PublishedProductRecord[]) => {
      const productsToSave = recordsToSave ?? products;
      if (!etag || schemaVersion === null || meta === null) {
        setSaveError("Cannot save: candidate snapshot metadata was not loaded.");
        return;
      }
      setSaveError("");
      setStatusMessage("Saving…");
      startSaveTransition(async () => {
        const newEtag = await postDocument("candidate", productsToSave, schemaVersion, meta, etag);
        if (newEtag !== null) {
          setEtag(newEtag);
          setSaveError("");
          setStatusMessage(`Saved ${productsToSave.length} candidate records to disk.`);
        }
      });
    },
    [products, etag, schemaVersion, meta, postDocument, setSaveError, setStatusMessage]
  );

  const handlePromoteToAdded = useCallback(() => {
    if (!selected || !etag || schemaVersion === null || meta === null) return;

    const promotedRecord = { ...selected };
    delete promotedRecord.tracking_priority;
    delete promotedRecord.tracking_status;
    delete promotedRecord.tracking_gatherer;
    delete promotedRecord.tracking_reviewer;

    const newSourceArray = products.filter((p) => p.slug !== selected.slug);

    startSaveTransition(async () => {
      let destDoc;
      try {
        destDoc = await fetchDocument("/api/local/added");
      } catch {
        setSaveError("Save failed: could not reach the local write API for added.json.");
        return;
      }
      if (!destDoc.etag || destDoc.schemaVersion === null || destDoc.meta === null) {
        setSaveError("Cannot promote: added.json snapshot metadata was not loaded.");
        return;
      }
      const newDestArray = [promotedRecord, ...destDoc.products];
      const destEtag = await postDocument("added", newDestArray, destDoc.schemaVersion, destDoc.meta, destDoc.etag);
      if (destEtag === null) return;

      const sourceEtag = await postDocument("candidate", newSourceArray, schemaVersion, meta, etag);
      if (sourceEtag === null) return;

      router.push("/editor/candidates");
    });
  }, [selected, products, etag, schemaVersion, meta, postDocument, router, setSaveError]);

  const handleDeleteConfirm = useCallback(() => {
    if (!selected || !etag || schemaVersion === null || meta === null) return;
    const newArray = products.filter((p) => p.slug !== selected.slug);
    setSaveError("");
    setStatusMessage("Saving…");
    startSaveTransition(async () => {
      const newEtag = await postDocument("candidate", newArray, schemaVersion, meta, etag);
      if (newEtag !== null) router.push("/editor/candidates");
    });
  }, [selected, products, etag, schemaVersion, meta, postDocument, router, setSaveError, setStatusMessage]);

  if (!selected) return null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-bold text-gray-900 whitespace-nowrap shrink-0">Candidate Products Editor</h1>
      </header>

      <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
        <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Tracking</div>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Priority
            <select
              value={selected.tracking_priority ?? ""}
              onChange={(e) => setProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, tracking_priority: e.target.value || null } : p)))}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">set priority</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </label>

          <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Status
            <select
              value={selected.tracking_status ?? ""}
              onChange={(e) => setProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, tracking_status: e.target.value || null } : p)))}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">set status</option>
              <option value="Gathering">Gathering</option>
              <option value="Needs Review">Needs Review</option>
              <option value="Discussion">Discussion</option>
              <option value="Ready for Site">Ready for Site</option>
            </select>
          </label>

          <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Gatherer
            <select
              value={selected.tracking_gatherer ?? ""}
              onChange={(e) => setProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, tracking_gatherer: e.target.value || null } : p)))}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">set gatherer</option>
              {RESEARCHER_NAMES.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>

          <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Reviewer
            <select
              value={selected.tracking_reviewer ?? ""}
              onChange={(e) => setProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, tracking_reviewer: e.target.value || null } : p)))}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">set reviewer</option>
              {RESEARCHER_NAMES.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
        <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Edit</div>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <button type="button" ref={editHeaderButtonRef} onClick={() => setIsHeaderEditorOpen(true)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Header
          </button>
          <button type="button" ref={editVendorResourcesButtonRef} onClick={() => setIsVendorResourcesEditorOpen(true)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Vendor Resources
          </button>
          <button type="button" ref={editOtherResourcesButtonRef} onClick={() => setIsOtherResourcesEditorOpen(true)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Other Resources
          </button>
          <button type="button" ref={editSupportButtonRef} onClick={() => setIsSupportEditorOpen(true)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Support
          </button>
          <button type="button" ref={editAcrButtonRef} onClick={() => setIsAcrEditorOpen(true)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            ACR
          </button>
          <button type="button" ref={importCandidateButtonRef} onClick={() => setIsImportModalOpen(true)} className="ml-3.5 rounded border border-transparent bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Import Candidate
          </button>
        </div>
      </div>

      <section aria-label="Visual preview" className="rounded border border-gray-200 bg-gray-50 p-4">
        <div className="flex justify-end gap-3 pb-[10px]">
          <button type="button" onClick={handlePromoteToAdded} disabled={isSaving} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Added to Site
          </button>
          <button type="button" onClick={() => handleSaveToServer()} disabled={isSaving} className="rounded border border-transparent bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500">
            {isSaving ? "Saving…" : "Save candidate"}
          </button>
          <button type="button" ref={deleteCandidateButtonRef} onClick={() => setIsDeleteModalOpen(true)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
            Delete Candidate
          </button>
        </div>

        {listing ? (
          <div className="w-full bg-white shadow-sm border border-gray-200 rounded-lg overflow-hidden">
            <ListingCard listing={listing} />
          </div>
        ) : null}
      </section>

      {isHeaderEditorOpen ? (
        <PublishedHeaderEditor key={selected.slug} record={selected} onSave={handleHeaderSave} onClose={handleHeaderEditorClosed} />
      ) : null}
      {isVendorResourcesEditorOpen ? (
        <PublishedVendorResourcesEditor key={selected.slug} record={selected} onSave={handleVendorResourcesSave} onClose={handleVendorResourcesEditorClosed} />
      ) : null}
      {isOtherResourcesEditorOpen ? (
        <PublishedOtherResourcesEditor key={selected.slug} record={selected} onSave={handleOtherResourcesSave} onClose={handleOtherResourcesEditorClosed} />
      ) : null}
      {isSupportEditorOpen ? (
        <PublishedSupportEditor key={selected.slug} record={selected} onSave={handleSupportSave} onClose={handleSupportEditorClosed} />
      ) : null}
      {isAcrEditorOpen ? (
        <PublishedAcrEditor key={selected.slug} record={selected} onSave={handleAcrSave} onClose={handleAcrEditorClosed} />
      ) : null}
      {isImportModalOpen ? <ImportJsonModal onImport={handleImport} onClose={handleImportModalClosed} /> : null}
      {isDeleteModalOpen ? <DeleteCandidateModal onConfirm={handleDeleteConfirm} onClose={handleDeleteModalClosed} /> : null}
    </div>
  );
}
