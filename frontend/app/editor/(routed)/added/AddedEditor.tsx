// frontend/app/editor/(routed)/added/AddedEditor.tsx
"use client";

/**
 * Added tab's selected-record editor -- see
 * frontend/app/editor/(routed)/candidates/CandidateEditor.tsx for the
 * shared rationale (route-driven `slug`, remounts per record, router.push
 * back to the bare leaf after delete/promote). Differences, matching the
 * `activeTab === "added"` slice of the legacy monolith: Tracking fieldset
 * is Priority + Status only, no Import control, and the preview actions
 * are "Published" (promotes to published.json) / "Delete added" instead of
 * "Added to Site" / "Delete Candidate".
 */

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ListingCard } from "@/components/ListingCard";
import { PublishedHeaderEditor, type HeaderFields } from "@/components/PublishedHeaderEditor";
import { PublishedVendorResourcesEditor } from "@/components/PublishedVendorResourcesEditor";
import { PublishedOtherResourcesEditor } from "@/components/PublishedOtherResourcesEditor";
import { PublishedSupportEditor } from "@/components/PublishedSupportEditor";
import { PublishedAcrEditor } from "@/components/PublishedAcrEditor";
import { DeleteAddedModal } from "@/components/DeleteAddedModal";
import { toListingData } from "@/lib/editor-preview";
import vendorsData from "@/lib/vendors.json";
import { useMessages } from "@/components/IntegratedListPanel";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import type { SnapshotMeta } from "@/lib/local-data";
import type {
  PublishedAcrReport,
  PublishedProductRecord,
  PublishedResourceLink,
  PublishedSupportContact,
} from "@/lib/published-tables";

interface VendorRegistryEntry {
  vendor_name: string;
  // See CandidateEditor.tsx's identical VendorRegistryEntry comment: the
  // vendor-level resources a product's "From {Vendor}" section actually
  // shows live in vendors.json's other_resources field, not
  // vendor_resources (empty for every vendor in the current data).
  other_resources: PublishedResourceLink[];
}
const VENDORS_REGISTRY: VendorRegistryEntry[] = vendorsData.vendors as unknown as VendorRegistryEntry[];

interface AddedEditorProps {
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
  const body = (await res.json()) as { $schema_version?: unknown; $meta?: unknown; products?: unknown; $etag?: unknown };
  // Header first, `$etag` (the same value, echoed into the body by the
  // route) as fallback -- see app/api/local/vendors/route.ts's GET for why
  // the header alone isn't reliable behind a compressing intermediary like
  // the nerd_cloud.sh Cloudflare tunnel.
  const etag = res.headers.get("ETag") ?? (typeof body.$etag === "string" ? body.$etag : null);
  return {
    products: Array.isArray(body.products) ? (body.products as PublishedProductRecord[]) : [],
    schemaVersion: typeof body.$schema_version === "number" ? body.$schema_version : null,
    meta: body.$meta ? (body.$meta as SnapshotMeta) : null,
    etag,
  };
}

export function AddedEditor({ slug, initialProducts, initialSchemaVersion, initialMeta, initialEtag }: AddedEditorProps) {
  const router = useRouter();

  const [products, setProducts] = useState<PublishedProductRecord[]>(initialProducts);
  const [schemaVersion] = useState(initialSchemaVersion);
  const [meta] = useState(initialMeta);
  const [etag, setEtag] = useState<string | null>(initialEtag);

  // See CandidateEditor.tsx's own comment on this pattern (plain state,
  // not a ref read during render -- forbidden by this repo's
  // eslint-plugin-react-hooks config).
  const [isDirty, setIsDirty] = useState(false);
  useUnsavedChangesGuard(isDirty);

  const updateProducts = useCallback((updater: (prev: PublishedProductRecord[]) => PublishedProductRecord[]) => {
    setProducts(updater);
    setIsDirty(true);
  }, []);

  const { setStatusMessage, setSaveError } = useMessages();
  const [isSaving, startSaveTransition] = useTransition();

  const [isHeaderEditorOpen, setIsHeaderEditorOpen] = useState(false);
  const [isVendorResourcesEditorOpen, setIsVendorResourcesEditorOpen] = useState(false);
  const [isOtherResourcesEditorOpen, setIsOtherResourcesEditorOpen] = useState(false);
  const [isSupportEditorOpen, setIsSupportEditorOpen] = useState(false);
  const [isAcrEditorOpen, setIsAcrEditorOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  const editHeaderButtonRef = useRef<HTMLButtonElement>(null);
  const editVendorResourcesButtonRef = useRef<HTMLButtonElement>(null);
  const editOtherResourcesButtonRef = useRef<HTMLButtonElement>(null);
  const editSupportButtonRef = useRef<HTMLButtonElement>(null);
  const editAcrButtonRef = useRef<HTMLButtonElement>(null);
  const deleteAddedButtonRef = useRef<HTMLButtonElement>(null);

  const selected = useMemo(() => products.find((p) => p.slug === slug) ?? null, [products, slug]);

  const listing = useMemo(() => {
    if (!selected) return null;
    const globalVendor = VENDORS_REGISTRY.find((v) => v.vendor_name === selected.vendor_name);
    const previewRecord = {
      ...selected,
      vendor_resources: [...(selected.vendor_resources || []), ...(globalVendor?.other_resources || [])],
    };
    return toListingData(previewRecord);
  }, [selected]);

  const handleHeaderSave = useCallback(
    (fields: HeaderFields) => {
      updateProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, ...fields } : p)));
      setStatusMessage(`Updated header for ${fields.product_name} (not yet saved to disk).`);
    },
    [slug, setStatusMessage, updateProducts]
  );
  const handleHeaderEditorClosed = useCallback(() => {
    setIsHeaderEditorOpen(false);
    editHeaderButtonRef.current?.focus();
  }, []);

  const handleVendorResourcesSave = useCallback(
    (resources: PublishedResourceLink[]) => {
      updateProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, vendor_resources: resources } : p)));
      setStatusMessage(
        `Updated vendor resources (${resources.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [slug, selected?.product_name, setStatusMessage, updateProducts]
  );
  const handleVendorResourcesEditorClosed = useCallback(() => {
    setIsVendorResourcesEditorOpen(false);
    editVendorResourcesButtonRef.current?.focus();
  }, []);

  const handleOtherResourcesSave = useCallback(
    (resources: PublishedResourceLink[]) => {
      updateProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, other_resources: resources } : p)));
      setStatusMessage(
        `Updated other resources (${resources.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [slug, selected?.product_name, setStatusMessage, updateProducts]
  );
  const handleOtherResourcesEditorClosed = useCallback(() => {
    setIsOtherResourcesEditorOpen(false);
    editOtherResourcesButtonRef.current?.focus();
  }, []);

  const handleSupportSave = useCallback(
    (contacts: PublishedSupportContact[]) => {
      updateProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, support_contacts: contacts } : p)));
      setStatusMessage(
        `Updated support contacts (${contacts.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [slug, selected?.product_name, setStatusMessage, updateProducts]
  );
  const handleSupportEditorClosed = useCallback(() => {
    setIsSupportEditorOpen(false);
    editSupportButtonRef.current?.focus();
  }, []);

  const handleAcrSave = useCallback(
    (reports: PublishedAcrReport[]) => {
      updateProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, acr_reports: reports } : p)));
      setStatusMessage(
        `Updated ACR reports (${reports.length}) for ${selected?.product_name ?? "this record"} (not yet saved to disk).`
      );
    },
    [slug, selected?.product_name, setStatusMessage, updateProducts]
  );
  const handleAcrEditorClosed = useCallback(() => {
    setIsAcrEditorOpen(false);
    editAcrButtonRef.current?.focus();
  }, []);

  const handleDeleteModalClosed = useCallback(() => {
    setIsDeleteModalOpen(false);
    deleteAddedButtonRef.current?.focus();
  }, []);

  const postDocument = useCallback(
    async (
      kind: "added" | "published",
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
        setSaveError("Cannot save: added snapshot metadata was not loaded.");
        return;
      }
      setSaveError("");
      setStatusMessage("Saving…");
      startSaveTransition(async () => {
        const newEtag = await postDocument("added", productsToSave, schemaVersion, meta, etag);
        if (newEtag !== null) {
          setEtag(newEtag);
          setIsDirty(false);
          setSaveError("");
          setStatusMessage(`Saved ${productsToSave.length} added records to disk.`);
          router.refresh();
        }
      });
    },
    [products, etag, schemaVersion, meta, postDocument, router, setSaveError, setStatusMessage]
  );

  const handlePromoteToPublished = useCallback(() => {
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
        destDoc = await fetchDocument("/api/local/published");
      } catch {
        setSaveError("Save failed: could not reach the local write API for published.json.");
        return;
      }
      if (!destDoc.etag || destDoc.schemaVersion === null || destDoc.meta === null) {
        setSaveError("Cannot promote: published.json snapshot metadata was not loaded.");
        return;
      }
      const newDestArray = [promotedRecord, ...destDoc.products];
      const destEtag = await postDocument("published", newDestArray, destDoc.schemaVersion, destDoc.meta, destDoc.etag);
      if (destEtag === null) return;

      const sourceEtag = await postDocument("added", newSourceArray, schemaVersion, meta, etag);
      if (sourceEtag === null) return;

      setIsDirty(false);
      router.refresh();
      router.push("/editor/added");
    });
  }, [selected, products, etag, schemaVersion, meta, postDocument, router, setSaveError]);

  const handleDeleteAddedConfirm = useCallback(() => {
    if (!selected || !etag || schemaVersion === null || meta === null) return;
    const newArray = products.filter((p) => p.slug !== selected.slug);
    setSaveError("");
    setStatusMessage("Saving…");
    startSaveTransition(async () => {
      const newEtag = await postDocument("added", newArray, schemaVersion, meta, etag);
      if (newEtag !== null) {
        setIsDirty(false);
        router.refresh();
        router.push("/editor/added");
      }
    });
  }, [selected, products, etag, schemaVersion, meta, postDocument, router, setSaveError, setStatusMessage]);

  if (!selected) return null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-bold text-gray-900 whitespace-nowrap shrink-0">Added Products Editor</h1>
      </header>

      <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
        <div className="flex items-center rounded-t-md bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase text-gray-500 border-b border-gray-300">Tracking</div>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <label className="flex flex-col items-start gap-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Priority
            <select
              value={selected.tracking_priority ?? ""}
              onChange={(e) => updateProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, tracking_priority: e.target.value || null } : p)))}
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
              onChange={(e) => updateProducts((prev) => prev.map((p) => (p.slug === slug ? { ...p, tracking_status: e.target.value || null } : p)))}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">set status</option>
              <option value="contacted vendor">contacted vendor</option>
              <option value="replied back to vendor">replied back to vendor</option>
            </select>
          </label>

          <div className="ml-auto">
            <button
              type="button"
              onClick={handlePromoteToPublished}
              disabled={isSaving}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Published
            </button>
          </div>
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
          <div className="ml-auto flex gap-3">
            <button type="button" onClick={() => handleSaveToServer()} disabled={isSaving} className="rounded border border-transparent bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500">
              {isSaving ? "Saving…" : "Save added"}
            </button>
            <button type="button" ref={deleteAddedButtonRef} onClick={() => setIsDeleteModalOpen(true)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
              Delete added
            </button>
          </div>
        </div>
      </div>

      <section aria-label="Visual preview" className="rounded border border-gray-200 bg-gray-50 p-4">
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
      {isDeleteModalOpen ? <DeleteAddedModal onConfirm={handleDeleteAddedConfirm} onClose={handleDeleteModalClosed} /> : null}
    </div>
  );
}
