// frontend/app/editor/(routed)/vendors/[slug]/VendorEditor.tsx
"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useMessages } from "@/components/IntegratedListPanel";
import { useUnsavedChangesGuard } from "@/lib/useUnsavedChangesGuard";
import { DirectoryPreview } from "@/components/DirectoryPreview";
import { DirectoryHeaderEditor, type DirectoryHeaderFields } from "@/components/DirectoryHeaderEditor";
import { VendorGlobalResourcesEditor, type DirectoryResourcesUpdate } from "@/components/VendorGlobalResourcesEditor";
import { VendorProductsEditor } from "@/components/VendorProductsEditor";
import { VendorSupportEditor } from "@/components/VendorSupportEditor";
import { VendorCreateModal } from "@/components/VendorCreateModal";
import type { DirectoryRecord, DirectoryFile, DirectoryProductLink } from "@/lib/directory-schema";
import type { PublishedSupportContact } from "@/lib/published-tables";

interface VendorEditorProps {
  record: DirectoryRecord;
  existingVendorNames?: string[];
}

export function VendorEditor({ record: initialRecord, existingVendorNames = [] }: VendorEditorProps) {
  const router = useRouter();
  const { setStatusMessage, setSaveError, setCreateAction } = useMessages();

  const [record, setRecord] = useState<DirectoryRecord>(initialRecord);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();

  // True from handleAddVendor until the draft is actually persisted --
  // `record` at that point is a brand-new vendor that has never existed on
  // disk under any slug, unlike `initialSlug` below (this page's ORIGINAL
  // vendor, e.g. "adobe" if that's what was open when Add Vendor was
  // clicked). saveToServer and handleDelete both need to know which mode
  // they're in: identity lookups keyed on `initialSlug` are correct for
  // editing/renaming the record this page loaded, but would silently
  // overwrite (or delete) that unrelated original vendor if applied to a
  // just-added draft instead.
  const [isNewVendorDraft, setIsNewVendorDraft] = useState(false);

  useUnsavedChangesGuard(isDirty);

  // Modals
  const [isHeaderEditorOpen, setIsHeaderEditorOpen] = useState(false);
  const [isGlobalResourcesEditorOpen, setIsGlobalResourcesEditorOpen] = useState(false);
  const [isProductsEditorOpen, setIsProductsEditorOpen] = useState(false);
  const [isSupportEditorOpen, setIsSupportEditorOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // "Add Vendor" now renders in IntegratedListPanel.tsx's sidebar footer
  // (Phase 4.15) -- see CandidateEditor.tsx's identical pattern for
  // "Import Candidate". This component still owns the modal and its
  // handlers, so it registers a trigger callback into the shared
  // MessagesContext for the footer button to call, and unregisters it on
  // unmount so a stale handler from a previous record can't linger.
  useEffect(() => {
    setCreateAction(() => () => setIsCreateModalOpen(true));
    return () => setCreateAction(null);
  }, [setCreateAction]);

  const handleHeaderSave = useCallback((fields: DirectoryHeaderFields) => {
    setRecord((prev) => ({ ...prev, ...fields }));
    setIsDirty(true);
    setStatusMessage(`Updated header for ${fields.product_name} (not yet saved to disk).`);
    setIsHeaderEditorOpen(false);
  }, [setStatusMessage]);

  // The three handlers below receive DirectoryRecord-shaped payloads
  // directly from the (now-native) dialogs -- no bridge/conversion needed.
  const handleGlobalResourcesSave = useCallback((resources: DirectoryResourcesUpdate) => {
    setRecord((prev) => ({ ...prev, ...resources }));
    setIsDirty(true);
    const total = resources.vendor_resources.length + resources.other_resources.length;
    setStatusMessage(`Updated global resources (${total}) (not yet saved to disk).`);
    setIsGlobalResourcesEditorOpen(false);
  }, [setStatusMessage]);

  const handleProductsSave = useCallback((products: DirectoryProductLink[]) => {
    setRecord((prev) => ({ ...prev, products }));
    setIsDirty(true);
    setStatusMessage(`Updated products (${products.length}) (not yet saved to disk).`);
    setIsProductsEditorOpen(false);
  }, [setStatusMessage]);

  const handleSupportSave = useCallback((contacts: PublishedSupportContact[]) => {
    setRecord((prev) => ({ ...prev, support_contacts: contacts }));
    setIsDirty(true);
    setStatusMessage(`Updated support contacts (${contacts.length}) (not yet saved to disk).`);
    setIsSupportEditorOpen(false);
  }, [setStatusMessage]);

  const handleStatusChange = useCallback((status: "ready for site" | "published to site" | null) => {
    setRecord((prev) => ({ ...prev, tracking_status: status }));
    setIsDirty(true);
    setStatusMessage(`Updated status (not yet saved to disk).`);
  }, [setStatusMessage]);

  // Identity for array matching/routing uses `slug`, not `vendor_name`:
  // every record in vendors.json currently has vendor_name: null (see
  // directory-schema.ts's header on this data bug), so vendor_name can't
  // distinguish records. slug is the one field that's actually unique and
  // populated. NOTE: ../VendorsListPanel.tsx and ../[slug]/page.tsx (both
  // out of scope here) still build hrefs and look up records by
  // vendor_name -- until those are migrated too, saving/deleting here will
  // work correctly but the post-save navigation below will not land on a
  // matching route. Flagged in this pass's report.
  const initialSlug = initialRecord.slug;

  const saveToServer = useCallback(async (recordToSave: DirectoryRecord, isDelete = false) => {
    setSaveError("");
    setStatusMessage(isDelete ? "Deleting vendor…" : "Saving vendor…");

    try {
      // 1. GET fresh data and ETag
      const getRes = await fetch("/api/local/vendors");
      if (!getRes.ok) throw new Error(`GET failed with ${getRes.status}`);
      const body = (await getRes.json()) as DirectoryFile & { $etag?: string };
      // Header first, `$etag` (the same value, echoed into the body by the
      // route) as fallback -- a compressing intermediary between this
      // server and the browser (confirmed against the nerd_cloud.sh
      // Cloudflare tunnel) can strip a custom response header like ETag
      // without touching the body, so the header alone isn't reliable
      // there even though it always is in local dev (no compressing proxy
      // in that path). See app/api/local/vendors/route.ts's GET.
      const etag = getRes.headers.get("ETag") ?? body.$etag ?? null;

      if (!etag || typeof body.$schema_version !== "number" || !body.$meta) {
        setSaveError("Cannot save: vendors snapshot metadata was not loaded.");
        return;
      }

      const currentVendors = Array.isArray(body.vendors) ? body.vendors : [];

      let updatedVendors: DirectoryRecord[];
      if (isDelete) {
        updatedVendors = currentVendors.filter((v) => v.slug !== initialSlug);
      } else if (isNewVendorDraft) {
        // recordToSave has never been on disk -- identity is its OWN slug,
        // not initialSlug (this page's original, unrelated vendor). Re-check
        // for a collision here (not just VendorCreateModal's product_name
        // check at draft time) in case another save landed a same-slug
        // vendor on disk in between.
        if (currentVendors.some((v) => v.slug === recordToSave.slug)) {
          setSaveError(`A vendor named "${recordToSave.product_name}" already exists.`);
          return;
        }
        updatedVendors = [...currentVendors, recordToSave];
      } else {
        const exists = currentVendors.some((v) => v.slug === initialSlug);
        updatedVendors = exists
          ? currentVendors.map((v) => (v.slug === initialSlug ? recordToSave : v))
          : [...currentVendors, recordToSave];
      }

      // 2. POST updated array
      const postRes = await fetch("/api/local/vendors", {
        method: "POST",
        headers: { "Content-Type": "application/json", "If-Match": etag },
        body: JSON.stringify({
          $schema_version: body.$schema_version,
          $meta: body.$meta,
          vendors: updatedVendors,
        }),
      });

      if (postRes.status === 412) {
        setSaveError("Save failed because the data was changed on a different tab or by another user. Reload the page and re-apply your edits.");
        return;
      }

      if (!postRes.ok) {
        setSaveError(`Save failed: unexpected server response (${postRes.status}).`);
        return;
      }

      setIsDirty(false);
      // recordToSave now genuinely exists on disk under its own slug --
      // subsequent saves of this component instance (if the slug-changed
      // navigation below doesn't remount it first) should go through the
      // normal initialSlug-based rename/replace path, not the new-draft one.
      if (!isDelete) setIsNewVendorDraft(false);
      setStatusMessage(isDelete ? `Deleted "${initialRecord.product_name}".` : `Saved "${recordToSave.product_name}" to disk.`);

      router.refresh();

      // Delay navigation to allow router.refresh() to clear the server cache
      setTimeout(() => {
        if (isDelete) {
          router.push("/editor/vendors");
        } else if (recordToSave.slug !== initialSlug) {
          router.push(`/editor/vendors/${encodeURIComponent(recordToSave.slug)}`);
        }
      }, 100);

    } catch {
      setSaveError("Save failed: could not reach the local write API.");
    }
  }, [initialRecord.product_name, initialSlug, isNewVendorDraft, router, setSaveError, setStatusMessage]);

  const handleDelete = useCallback(() => {
    if (!window.confirm(`Permanently delete "${record.product_name}"? This cannot be undone.`)) return;
    startSaveTransition(() => {
      saveToServer(record, true);
    });
  }, [record, saveToServer]);

  // Stages the new vendor as this component's displayed record -- same
  // "not yet saved to disk" deferred pattern as CandidateEditor.tsx's
  // handleImport (see that file for the full rationale). No network call
  // here: the draft is only committed to vendors.json when the user
  // explicitly clicks "Save vendor" below, via the same saveToServer used
  // for editing an existing record, gated by isNewVendorDraft (see that
  // state's own comment for why it can't just reuse initialSlug).
  const handleAddVendor = useCallback((newRecord: DirectoryRecord) => {
    setRecord(newRecord);
    setIsDirty(true);
    setIsNewVendorDraft(true);
    setStatusMessage(`Added "${newRecord.product_name}" to the vendor list (not yet saved to disk).`);
    setIsCreateModalOpen(false);
  }, [setStatusMessage]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <h1 className="text-2xl font-bold text-gray-900 whitespace-nowrap shrink-0">Vendors Editor</h1>
      </header>

      {/* TRACKING SECTION */}
      <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-500">
          Tracking
        </div>
        <div className="p-4">
          <div className="flex flex-col items-start gap-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</label>
            <select
              value={record.tracking_status ?? ""}
              onChange={(e) => handleStatusChange((e.target.value as "ready for site" | "published to site") || null)}
              className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">set status</option>
              <option value="ready for site">ready for site</option>
              <option value="published to site">published to site</option>
            </select>
          </div>
        </div>
      </div>

      {/* EDIT SECTION */}
      <div className="w-full rounded-md border border-gray-300 bg-white mb-2">
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-500">
          Edit
        </div>
        <div className="flex flex-wrap items-center gap-2 p-4">
          <button
            type="button"
            onClick={() => setIsHeaderEditorOpen(true)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Header
          </button>
          <button
            type="button"
            onClick={() => setIsGlobalResourcesEditorOpen(true)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Global Resources
          </button>
          <button
            type="button"
            onClick={() => setIsProductsEditorOpen(true)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Product/s
          </button>
          <button
            type="button"
            onClick={() => setIsSupportEditorOpen(true)}
            className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Support
          </button>
          <div className="ml-auto flex gap-3">
            <button
              type="button"
              onClick={() => startSaveTransition(() => saveToServer(record))}
              disabled={isSaving}
              className="rounded border border-transparent bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {isSaving ? "Saving…" : "Save vendor"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={isSaving || isNewVendorDraft}
              title={isNewVendorDraft ? "Nothing to delete yet -- this vendor hasn't been saved." : undefined}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Delete vendor
            </button>
          </div>
        </div>
      </div>

      <section aria-label="Visual preview" className="rounded border border-gray-200 bg-gray-50 p-4">
        <div className="rounded-md border border-gray-200 bg-white p-6 shadow-sm">
          <DirectoryPreview record={record} />
        </div>
      </section>

      {/* Editors */}
      {isHeaderEditorOpen && (
        <DirectoryHeaderEditor
          record={record}
          onSave={handleHeaderSave}
          onClose={() => setIsHeaderEditorOpen(false)}
        />
      )}
      {isGlobalResourcesEditorOpen && (
        <VendorGlobalResourcesEditor
          record={record}
          onSave={handleGlobalResourcesSave}
          onClose={() => setIsGlobalResourcesEditorOpen(false)}
        />
      )}
      {isProductsEditorOpen && (
        <VendorProductsEditor
          record={record}
          onSave={handleProductsSave}
          onClose={() => setIsProductsEditorOpen(false)}
        />
      )}
      {isSupportEditorOpen && (
        <VendorSupportEditor
          record={record}
          onSave={handleSupportSave}
          onClose={() => setIsSupportEditorOpen(false)}
        />
      )}
      {isCreateModalOpen && (
        <VendorCreateModal
          isOpen={isCreateModalOpen}
          existingVendorNames={existingVendorNames}
          onAdd={handleAddVendor}
          onClose={() => setIsCreateModalOpen(false)}
        />
      )}
    </div>
  );
}
