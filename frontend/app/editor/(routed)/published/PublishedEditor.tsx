// frontend/app/editor/(routed)/published/PublishedEditor.tsx
"use client";

/**
 * Published tab's selected-record editor -- see
 * frontend/app/editor/(routed)/candidates/CandidateEditor.tsx for the
 * shared rationale. Differences, matching the `activeTab === "published"`
 * slice of the legacy monolith: Tracking fieldset is Priority only, no
 * promote action (published is the terminal tab), and the preview actions
 * are Save / "Delete published" only.
 */

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ListingCard } from "@/components/ListingCard";
import { PublishedHeaderEditor, type HeaderFields } from "@/components/PublishedHeaderEditor";
import { PublishedVendorResourcesEditor } from "@/components/PublishedVendorResourcesEditor";
import { PublishedOtherResourcesEditor } from "@/components/PublishedOtherResourcesEditor";
import { PublishedSupportEditor } from "@/components/PublishedSupportEditor";
import { PublishedAcrEditor } from "@/components/PublishedAcrEditor";
import { DeletePublishedModal } from "@/components/DeletePublishedModal";
import { CodeViewModal } from "@/components/CodeViewModal";
import { toListingData } from "@/lib/editor-preview";
import { buildNcademiListingHtml } from "@/lib/ncademiPreview";
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

interface PublishedEditorProps {
  slug: string;
  initialProducts: PublishedProductRecord[];
  initialSchemaVersion: number | null;
  initialMeta: SnapshotMeta | null;
  initialEtag: string;
}

export function PublishedEditor({ slug, initialProducts, initialSchemaVersion, initialMeta, initialEtag }: PublishedEditorProps) {
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
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);

  const editHeaderButtonRef = useRef<HTMLButtonElement>(null);
  const editVendorResourcesButtonRef = useRef<HTMLButtonElement>(null);
  const editOtherResourcesButtonRef = useRef<HTMLButtonElement>(null);
  const editSupportButtonRef = useRef<HTMLButtonElement>(null);
  const editAcrButtonRef = useRef<HTMLButtonElement>(null);
  const deletePublishedButtonRef = useRef<HTMLButtonElement>(null);
  const codeButtonRef = useRef<HTMLButtonElement>(null);

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

  // Same HTML string ListingCard.tsx builds for the live preview iframe --
  // the Code modal shows it as read-only text instead of rendering it. See
  // CodeViewModal.tsx's header comment.
  const codeHtml = useMemo(() => (listing ? buildNcademiListingHtml(listing) : ""), [listing]);

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
  const handleCodeModalClosed = useCallback(() => {
    setIsCodeModalOpen(false);
    codeButtonRef.current?.focus();
  }, []);

  const handleDeleteModalClosed = useCallback(() => {
    setIsDeleteModalOpen(false);
    deletePublishedButtonRef.current?.focus();
  }, []);

  const handleSaveToServer = useCallback(
    (recordsToSave?: PublishedProductRecord[]) => {
      const productsToSave = recordsToSave ?? products;
      if (!etag || schemaVersion === null || meta === null) {
        setSaveError("Cannot save: published snapshot metadata was not loaded.");
        return;
      }
      setSaveError("");
      setStatusMessage("Saving…");
      startSaveTransition(async () => {
        const res = await fetch("/api/local/published", {
          method: "POST",
          headers: { "Content-Type": "application/json", "If-Match": etag },
          body: JSON.stringify({ $schema_version: schemaVersion, $meta: meta, products: productsToSave }),
        });

        if (res.status === 412) {
          setSaveError("Save failed: the file on disk changed since this copy was loaded. Reload the page and re-apply your edits.");
          return;
        }
        if (res.status === 400) {
          const errorBody = await res.json().catch(() => null);
          setSaveError(`Save failed: ${errorBody?.error ?? "the server rejected this data."}`);
          return;
        }
        if (!res.ok) {
          setSaveError(`Save failed: unexpected server response (${res.status}).`);
          return;
        }
        const result = (await res.json()) as { etag?: string };
        setEtag(res.headers.get("ETag") ?? result.etag ?? null);
        setIsDirty(false);
        setSaveError("");
        setStatusMessage(`Saved ${productsToSave.length} published records to disk.`);
        router.refresh();
      });
    },
    [products, etag, schemaVersion, meta, router, setSaveError, setStatusMessage]
  );

  const handleDeletePublishedConfirm = useCallback(() => {
    if (!selected || !etag || schemaVersion === null || meta === null) return;
    const newArray = products.filter((p) => p.slug !== selected.slug);
    setSaveError("");
    setStatusMessage("Saving…");
    startSaveTransition(async () => {
      const res = await fetch("/api/local/published", {
        method: "POST",
        headers: { "Content-Type": "application/json", "If-Match": etag },
        body: JSON.stringify({ $schema_version: schemaVersion, $meta: meta, products: newArray }),
      });
      if (res.ok) {
        setIsDirty(false);
        router.refresh();
        router.push("/editor/published");
      } else {
        setSaveError(`Save failed: unexpected server response (${res.status}).`);
      }
    });
  }, [selected, products, etag, schemaVersion, meta, router, setSaveError, setStatusMessage]);

  if (!selected) return null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-bold text-gray-900 whitespace-nowrap shrink-0">Published Products Editor</h1>
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
          <button
            type="button"
            ref={codeButtonRef}
            onClick={() => setIsCodeModalOpen(true)}
            aria-label="Code"
            className="rounded border border-gray-300 bg-white p-2 text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Image src="/code.svg" alt="" width={18} height={18} className="h-4 w-4" />
          </button>
          <div className="ml-auto flex gap-3">
            <button type="button" onClick={() => handleSaveToServer()} disabled={isSaving} className="rounded border border-transparent bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500">
              {isSaving ? "Saving…" : "Save published"}
            </button>
            <button type="button" ref={deletePublishedButtonRef} onClick={() => setIsDeleteModalOpen(true)} className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500">
              Delete published
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
      {isDeleteModalOpen ? <DeletePublishedModal onConfirm={handleDeletePublishedConfirm} onClose={handleDeleteModalClosed} /> : null}
      {isCodeModalOpen ? <CodeViewModal code={codeHtml} onClose={handleCodeModalClosed} /> : null}
    </div>
  );
}
