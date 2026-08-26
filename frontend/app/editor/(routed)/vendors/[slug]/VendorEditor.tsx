// frontend/app/editor/(routed)/vendors/[slug]/VendorEditor.tsx
"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useMessages } from "../VendorsListPanel";
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
  const { setStatusMessage, setSaveError } = useMessages();

  const [record, setRecord] = useState<DirectoryRecord>(initialRecord);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, startSaveTransition] = useTransition();

  useUnsavedChangesGuard(isDirty);

  // Modals
  const [isHeaderEditorOpen, setIsHeaderEditorOpen] = useState(false);
  const [isGlobalResourcesEditorOpen, setIsGlobalResourcesEditorOpen] = useState(false);
  const [isProductsEditorOpen, setIsProductsEditorOpen] = useState(false);
  const [isSupportEditorOpen, setIsSupportEditorOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

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
      const etag = getRes.headers.get("ETag");
      const body = (await getRes.json()) as DirectoryFile;

      if (!etag || typeof body.$schema_version !== "number" || !body.$meta) {
        setSaveError("Cannot save: vendors snapshot metadata was not loaded.");
        return;
      }

      const currentVendors = Array.isArray(body.vendors) ? body.vendors : [];

      let updatedVendors: DirectoryRecord[];
      if (isDelete) {
        updatedVendors = currentVendors.filter((v) => v.slug !== initialSlug);
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
        setSaveError("Save failed: the file on disk changed since this copy was loaded. Try again.");
        return;
      }

      if (!postRes.ok) {
        setSaveError(`Save failed: unexpected server response (${postRes.status}).`);
        return;
      }

      setIsDirty(false);
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
  }, [initialRecord.product_name, initialSlug, router, setSaveError, setStatusMessage]);

  const handleDelete = useCallback(() => {
    if (!window.confirm(`Permanently delete "${record.product_name}"? This cannot be undone.`)) return;
    startSaveTransition(() => {
      saveToServer(record, true);
    });
  }, [record, saveToServer]);

  const handleAddVendor = useCallback((newRecord: DirectoryRecord) => {
    setSaveError("");
    setStatusMessage("Adding vendor…");
    setIsCreateModalOpen(false);

    startSaveTransition(async () => {
      try {
        const getRes = await fetch("/api/local/vendors");
        if (!getRes.ok) throw new Error(`GET failed with ${getRes.status}`);
        const etag = getRes.headers.get("ETag");
        const body = (await getRes.json()) as DirectoryFile;

        if (!etag || typeof body.$schema_version !== "number" || !body.$meta) {
          setSaveError("Cannot add vendor: metadata not loaded.");
          return;
        }

        const currentVendors = Array.isArray(body.vendors) ? body.vendors : [];

        if (currentVendors.some((v) => v.slug === newRecord.slug)) {
          setSaveError(`A vendor named "${newRecord.product_name}" already exists.`);
          return;
        }

        const updatedVendors = [...currentVendors, newRecord];

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
          setSaveError("Add failed: the file on disk changed. Try again.");
          return;
        }
        if (!postRes.ok) {
          setSaveError(`Add failed: server response (${postRes.status}).`);
          return;
        }

        setStatusMessage(`Added "${newRecord.product_name}".`);

        router.refresh();

        // Delay navigation to allow router.refresh() to clear the server cache
        setTimeout(() => {
          router.push(`/editor/vendors/${encodeURIComponent(newRecord.slug)}`);
        }, 100);
      } catch {
        setSaveError("Add failed: could not reach the local write API.");
      }
    });
  }, [router, setSaveError, setStatusMessage]);

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-gray-900">Vendors Editor</h1>
        </header>

        {/* TRACKING SECTION */}
        <div className="rounded-md border border-gray-300 bg-white">
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
        <div className="rounded-md border border-gray-300 bg-white">
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
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              disabled={isSaving}
              className="ml-2 rounded border border-transparent bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Add Vendor
            </button>
          </div>
        </div>

        {/* PREVIEW & ACTIONS SECTION */}
        <section>
          <div className="mb-4 flex items-center justify-end gap-2">
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
              disabled={isSaving}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Delete vendor
            </button>
          </div>
          <div className="rounded-md border border-gray-200 bg-white p-6 shadow-sm">
            <DirectoryPreview record={record} />
          </div>
        </section>
      </div>

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
    </main>
  );
}
